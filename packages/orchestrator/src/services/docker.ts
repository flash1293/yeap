import Docker from 'dockerode'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { db } from '../db/index.js'
import { bots } from '../db/schema.js'
import { sql } from 'drizzle-orm'

const DOCKER_SOCKET = process.env['DOCKER_SOCKET'] ?? '/var/run/docker.sock'
const DOCKER_NETWORK = process.env['DOCKER_NETWORK'] ?? 'yeap-net'
const BOT_IMAGE = process.env['BOT_IMAGE'] ?? 'yeap-bot:latest'
const SECRETS_PATH = process.env['SECRETS_PATH'] ?? '/data/secrets.json'
const NGINX_BOTS_CONTAINER = process.env['NGINX_BOTS_CONTAINER'] ?? 'yeap-nginx-bots'
const NGINX_CONF_DIR = '/data/nginx-bots'
const HTPASSWD_PATH = '/data/htpasswd'
const OTEL_ENDPOINT = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? ''
const OTEL_HEADERS = process.env['OTEL_EXPORTER_OTLP_HEADERS'] ?? ''

export const docker = new Docker({ socketPath: DOCKER_SOCKET })

// Ensure the nginx bot config directory exists at startup
mkdirSync(NGINX_CONF_DIR, { recursive: true })

/** Write /data/htpasswd using the plaintext YEAP master password (SHA1 format). */
export function writeHtpasswd(plainPassword: string): void {
  const sha1 = createHash('sha1').update(plainPassword).digest('base64')
  writeFileSync(HTPASSWD_PATH, `yeap:{SHA}${sha1}\n`, 'utf8')
}

/** Write a per-bot nginx server block for the given host port. */
export function writeNginxBotConfig(name: string, hostPort: number): void {
  const cname = containerName(name)
  const conf = `server {
    listen ${hostPort};
    auth_basic "YEAP";
    auth_basic_user_file ${HTPASSWD_PATH};
    location / {
        proxy_pass http://${cname}:4096/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }
}\n`
  writeFileSync(join(NGINX_CONF_DIR, `${hostPort}.conf`), conf, 'utf8')
}

/** Remove the nginx server block for the given host port. */
export function deleteNginxBotConfig(hostPort: number): void {
  try { unlinkSync(join(NGINX_CONF_DIR, `${hostPort}.conf`)) } catch { /* already gone */ }
}

/** Signal the nginx-bots container to reload its configuration. */
export async function reloadNginxBots(): Promise<void> {
  try {
    const nginx = docker.getContainer(NGINX_BOTS_CONTAINER)
    const exec = await nginx.exec({ Cmd: ['nginx', '-s', 'reload'], AttachStdout: false, AttachStderr: false })
    await exec.start({ Detach: true })
  } catch (err) {
    console.warn('nginx-bots reload skipped (container may not be running yet):', err)
  }
}

type Secrets = { provider: string; model: string; api_key: string }

function readSecrets(): Secrets {
  return JSON.parse(readFileSync(SECRETS_PATH, 'utf8')) as Secrets
}

export function containerName(botName: string): string {
  return `yeap-bot-${botName.toLowerCase().replace(/[\s_]+/g, '-')}`
}

/** Find the next unused host port starting from 40960 */
export function allocateHostPort(): number {
  const row = db
    .select({ max: sql<number | null>`MAX(host_port)` })
    .from(bots)
    .get()
  const max = row?.max ?? null
  return max !== null ? max + 1 : 40960
}

function buildOpencodeConfig(): string {
  const { provider, model, api_key } = readSecrets()
  return JSON.stringify({
    model,
    provider: {
      [provider]: { options: { apiKey: api_key } },
    },
    plugin: ['/root/.config/opencode/plugins/yeap.js'],
    tools: { question: false },
    permission: {
      external_directory: { '/**': 'allow' },
      bash: { '/**': 'allow' },
    },
  })
}

export async function createAndStartBotContainer(
  name: string,
  role: string,
  hostPort: number,
): Promise<string> {
  const cname = containerName(name)
  const slug = name.toLowerCase().replace(/[\s_]+/g, '-')
  const skilletVolume = `yeap-skillet-${slug}`
  const opencodeVolume = `yeap-opencode-${slug}`
  const { model } = readSecrets()

  const container = await docker.createContainer({
    name: cname,
    Image: BOT_IMAGE,
    Hostname: cname,
    ExposedPorts: { '4096/tcp': {} },
    Env: [
      `BOT_NAME=${name}`,
      `BOT_ROLE=${role}`,
      `BOT_MODEL=${model}`,
      `GIT_AUTHOR_NAME=${name}`,
      `GIT_AUTHOR_EMAIL=${name.toLowerCase().replace(/\s+/g, '.')}@yeap.local`,
      `ORCHESTRATOR_URL=http://orchestrator:3000`,
      `REMINDER_URL=http://reminder:3001`,
      `SHARED_ROOT=/shared`,
      `OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_ENDPOINT}`,
      `OTEL_EXPORTER_OTLP_HEADERS=${OTEL_HEADERS}`,
      `OTEL_RESOURCE_ATTRIBUTES=service.name=${botServiceName},deployment.environment=production`,
      `OPENCODE_CONFIG_CONTENT=${buildOpencodeConfig()}`,
    ],
    HostConfig: {
      NetworkMode: DOCKER_NETWORK,
      Memory: 600 * 1024 * 1024,
      Mounts: [
        { Type: 'volume', Source: skilletVolume, Target: '/skillet' },
        { Type: 'volume', Source: 'yeap-shared', Target: '/shared' },
        { Type: 'volume', Source: opencodeVolume, Target: '/root/.local/share/opencode' },
      ],
      RestartPolicy: { Name: 'unless-stopped' },
    },
  }) as unknown as Docker.Container

  await container.start()
  writeNginxBotConfig(name, hostPort)
  await reloadNginxBots()
  return container.id
}

export async function createAndStartCoordinatorContainer(
  name: string,
  hostPort: number,
): Promise<string> {
  const role =
    'You are the coordinator of this YEAP installation. Your job is to be the ' +
    'primary point of contact for the human. Understand their goals, determine ' +
    'what specialist bots are needed, spawn them when necessary, delegate tasks ' +
    'via FSAD topics, and report progress and results back to the human.'

  const cname = containerName(name)
  const slug = name.toLowerCase().replace(/[\s_]+/g, '-')
  const skilletVolume = `yeap-skillet-${slug}`
  const opencodeVolume = `yeap-opencode-${slug}`
  const { model } = readSecrets()

  const container = await docker.createContainer({
    name: cname,
    Image: BOT_IMAGE,
    Hostname: cname,
    ExposedPorts: { '4096/tcp': {} },
    Env: [
      `BOT_NAME=${name}`,
      `BOT_ROLE=${role}`,
      `BOT_MODEL=${model}`,
      `IS_COORDINATOR=true`,
      `GIT_AUTHOR_NAME=${name}`,
      `GIT_AUTHOR_EMAIL=${name.toLowerCase()}@yeap.local`,
      `ORCHESTRATOR_URL=http://orchestrator:3000`,
      `REMINDER_URL=http://reminder:3001`,
      `SHARED_ROOT=/shared`,
      `OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_ENDPOINT}`,
      `OTEL_EXPORTER_OTLP_HEADERS=${OTEL_HEADERS}`,
      `OTEL_RESOURCE_ATTRIBUTES=service.name=yeap-bot-${name.toLowerCase().replace(/[\s_]+/g, '-')},deployment.environment=production`,
      `OPENCODE_CONFIG_CONTENT=${buildOpencodeConfig()}`,
    ],
    HostConfig: {
      NetworkMode: DOCKER_NETWORK,
      Mounts: [
        { Type: 'volume', Source: skilletVolume, Target: '/skillet' },
        { Type: 'volume', Source: 'yeap-shared', Target: '/shared' },
        { Type: 'volume', Source: opencodeVolume, Target: '/root/.local/share/opencode' },
      ],
      RestartPolicy: { Name: 'unless-stopped' },
      Memory: 600 * 1024 * 1024,
    },
  }) as unknown as Docker.Container

  await container.start()
  writeNginxBotConfig(name, hostPort)
  await reloadNginxBots()
  return container.id
}

export async function stopAndRemoveBotContainer(name: string): Promise<void> {
  const cname = containerName(name)
  let container: Docker.Container
  try {
    container = docker.getContainer(cname)
    await container.inspect() // throws if not found
  } catch {
    return // already gone
  }
  try { await container.stop({ t: 5 }) } catch { /* already stopped */ }
  await container.remove({ force: true })
}

/**
 * Run a shell script inside a bot's container and return the exit code
 * plus capped stdout/stderr (max 4 KB each).
 * Throws if the container is not found or the exec itself fails.
 */
export async function execInBotContainer(
  name: string,
  script: string,
  timeoutMs = 30_000,
): Promise<{ exit_code: number; stdout: string; stderr: string }> {
  const container = docker.getContainer(containerName(name))
  const exec = await container.exec({
    Cmd: ['sh', '-c', script],
    AttachStdout: true,
    AttachStderr: true,
  })

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('exec timed out')), timeoutMs)

exec.start({ hijack: true }, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
      if (err) { clearTimeout(timer); reject(err); return }
      if (!stream) { clearTimeout(timer); reject(new Error('exec.start returned no stream')); return }

      const stdoutBufs: Buffer[] = []
      const stderrBufs: Buffer[] = []
      const stdoutSink = new Writable({ write(c, _, cb) { stdoutBufs.push(Buffer.from(c as Buffer)); cb() } })
      const stderrSink = new Writable({ write(c, _, cb) { stderrBufs.push(Buffer.from(c as Buffer)); cb() } })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(docker as any).modem.demuxStream(stream, stdoutSink, stderrSink)

      stream.on('end', () => {
        clearTimeout(timer)
        exec.inspect().then((info: { ExitCode: number | null }) => {
          resolve({
            exit_code: info.ExitCode ?? 1,
            stdout: Buffer.concat(stdoutBufs).toString('utf8').slice(0, 4096),
            stderr: Buffer.concat(stderrBufs).toString('utf8').slice(0, 4096),
          })
        }).catch(reject)
      })

      stream.on('error', (e: Error) => { clearTimeout(timer); reject(e) })
    })
  })
}
