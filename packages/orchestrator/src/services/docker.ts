import Docker from 'dockerode'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { Writable } from 'node:stream'

const DOCKER_SOCKET = process.env['DOCKER_SOCKET'] ?? '/var/run/docker.sock'
const DOCKER_NETWORK = process.env['DOCKER_NETWORK'] ?? 'yeap-net'
const BOT_IMAGE = process.env['BOT_IMAGE'] ?? 'yeap-bot:latest'
const SECRETS_PATH = process.env['SECRETS_PATH'] ?? '/data/secrets.json'
const HTPASSWD_PATH = '/data/htpasswd'
const OTEL_ENDPOINT = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? ''
const OTEL_HEADERS = process.env['OTEL_EXPORTER_OTLP_HEADERS'] ?? ''
const BOT_MEMORY_MB = parseInt(process.env['BOT_MEMORY_MB'] ?? '600', 10)
const BOT_MEMORY_BYTES = BOT_MEMORY_MB * 1024 * 1024
const MATTERMOST_URL = process.env['MATTERMOST_URL'] ?? 'http://mattermost:8065'
const TAVILY_API_KEY = process.env['TAVILY_API_KEY'] ?? ''

export const docker = new Docker({ socketPath: DOCKER_SOCKET })

export function writeHtpasswd(plainPassword: string): void {
  const sha1 = createHash('sha1').update(plainPassword).digest('base64')
  writeFileSync(HTPASSWD_PATH, `yeap:{SHA}${sha1}\n`, 'utf8')
}

export function containerName(botName: string): string {
  return `yeap-bot-${botName.toLowerCase().replace(/[\s_]+/g, '-')}`
}

export function agentAdminUrl(botName: string): string {
  return `http://${containerName(botName)}:4096`
}

type Secrets = {
  provider: string
  model: string
  api_key: string
  base_url?: string
  context_window?: number
  max_output?: number
}

function readSecrets(): Secrets {
  return JSON.parse(readFileSync(SECRETS_PATH, 'utf8')) as Secrets
}

function buildBotEnvFromSecrets(): string[] {
  const { provider, model, api_key, base_url } = readSecrets()
  const envs: string[] = [`BOT_MODEL=${model}`]
  if (api_key) {
    const providerUpper = (model.includes('/') ? model.split('/')[0]! : provider).toUpperCase()
    envs.push(`${providerUpper}_API_KEY=${api_key}`)
    envs.push(`LLM_API_KEY=${api_key}`)
  }
  if (base_url) envs.push(`LLM_BASE_URL=${base_url}`)
  return envs
}

export async function createAndStartBotContainer(
  name: string,
  role: string,
  mmToken: string,
  mmUserId: string,
  mmTeamId?: string,
): Promise<string> {
  const cname = containerName(name)
  const slug = name.toLowerCase().replace(/[\s_]+/g, '-')
  const skilletVolume = `yeap-skillet-${slug}`

  const container = await (docker.createContainer({
    name: cname,
    Image: BOT_IMAGE,
    Hostname: cname,
    Env: [
      `BOT_NAME=${name}`,
      `BOT_ROLE=${role}`,
      `GIT_AUTHOR_NAME=${name}`,
      `GIT_AUTHOR_EMAIL=${name.toLowerCase().replace(/\s+/g, '.')}@yeap.local`,
      `ORCHESTRATOR_URL=http://orchestrator:3000`,
      `REMINDER_URL=http://reminder:3001`,
      `MATTERMOST_URL=${MATTERMOST_URL}`,
      `MATTERMOST_TOKEN=${mmToken}`,
      `MATTERMOST_USER_ID=${mmUserId}`,
      ...(mmTeamId ? [`MATTERMOST_TEAM_ID=${mmTeamId}`] : []),
      `OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_ENDPOINT}`,
      `OTEL_EXPORTER_OTLP_HEADERS=${OTEL_HEADERS}`,
      `OTEL_RESOURCE_ATTRIBUTES=service.name=yeap-bot-${slug},deployment.environment=production`,
      ...(TAVILY_API_KEY ? [`TAVILY_API_KEY=${TAVILY_API_KEY}`] : []),
      ...buildBotEnvFromSecrets(),
    ],
    HostConfig: {
      NetworkMode: DOCKER_NETWORK,
      Memory: BOT_MEMORY_BYTES,
      Mounts: [
        { Type: 'volume', Source: skilletVolume, Target: '/skillet' },
        { Type: 'volume', Source: 'yeap-shared', Target: '/shared' },
      ],
      RestartPolicy: { Name: 'unless-stopped' },
    },
  }) as unknown) as Docker.Container

  await container.start()
  return container.id
}

export async function createAndStartCoordinatorContainer(
  name: string,
  mmToken: string,
  mmUserId: string,
  mmTeamId?: string,
): Promise<string> {
  const role =
    'You are the coordinator of this YEAP installation. Your job is to be the ' +
    'primary point of contact for the human. Understand their goals, determine ' +
    'what specialist bots are needed, spawn them when necessary, delegate tasks ' +
    'via Mattermost channels, and report progress and results back to the human.'

  const cname = containerName(name)
  const slug = name.toLowerCase().replace(/[\s_]+/g, '-')
  const skilletVolume = `yeap-skillet-${slug}`

  const container = await (docker.createContainer({
    name: cname,
    Image: BOT_IMAGE,
    Hostname: cname,
    Env: [
      `BOT_NAME=${name}`,
      `BOT_ROLE=${role}`,
      `IS_COORDINATOR=true`,
      `GIT_AUTHOR_NAME=${name}`,
      `GIT_AUTHOR_EMAIL=${name.toLowerCase()}@yeap.local`,
      `ORCHESTRATOR_URL=http://orchestrator:3000`,
      `REMINDER_URL=http://reminder:3001`,
      `MATTERMOST_URL=${MATTERMOST_URL}`,
      `MATTERMOST_TOKEN=${mmToken}`,
      `MATTERMOST_USER_ID=${mmUserId}`,
      ...(mmTeamId ? [`MATTERMOST_TEAM_ID=${mmTeamId}`] : []),
      `OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_ENDPOINT}`,
      `OTEL_EXPORTER_OTLP_HEADERS=${OTEL_HEADERS}`,
      `OTEL_RESOURCE_ATTRIBUTES=service.name=yeap-bot-${slug},deployment.environment=production`,
      ...(TAVILY_API_KEY ? [`TAVILY_API_KEY=${TAVILY_API_KEY}`] : []),
      ...buildBotEnvFromSecrets(),
    ],
    HostConfig: {
      NetworkMode: DOCKER_NETWORK,
      Memory: BOT_MEMORY_BYTES,
      Mounts: [
        { Type: 'volume', Source: skilletVolume, Target: '/skillet' },
        { Type: 'volume', Source: 'yeap-shared', Target: '/shared' },
      ],
      RestartPolicy: { Name: 'unless-stopped' },
    },
  }) as unknown) as Docker.Container

  await container.start()
  return container.id
}

export async function stopAndRemoveBotContainer(name: string): Promise<void> {
  const cname = containerName(name)
  let container: Docker.Container
  try {
    container = docker.getContainer(cname)
    await container.inspect()
  } catch {
    return
  }
  try { await container.stop({ t: 5 }) } catch { /* already stopped */ }
  await container.remove({ force: true })
}

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
          const cap = (bufs: Buffer[]) => Buffer.concat(bufs).toString('utf8').slice(0, 4096)
          resolve({
            exit_code: info.ExitCode ?? 0,
            stdout: cap(stdoutBufs),
            stderr: cap(stderrBufs),
          })
        }).catch(reject)
      })
      stream.on('error', (e) => { clearTimeout(timer); reject(e) })
    })
  })
}
