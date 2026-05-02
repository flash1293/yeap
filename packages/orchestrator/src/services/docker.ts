import Docker from 'dockerode'
import { readFileSync } from 'node:fs'
import { db } from '../db/index.js'
import { bots } from '../db/schema.js'
import { sql } from 'drizzle-orm'

const DOCKER_SOCKET = process.env['DOCKER_SOCKET'] ?? '/var/run/docker.sock'
const DOCKER_NETWORK = process.env['DOCKER_NETWORK'] ?? 'yeap-net'
const BOT_IMAGE = process.env['BOT_IMAGE'] ?? 'yeap-bot:latest'
const SECRETS_PATH = process.env['SECRETS_PATH'] ?? '/data/secrets.json'

export const docker = new Docker({ socketPath: DOCKER_SOCKET })

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
      `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318`,
      `OPENCODE_CONFIG_CONTENT=${buildOpencodeConfig()}`,
    ],
    HostConfig: {
      NetworkMode: DOCKER_NETWORK,
      PortBindings: { '4096/tcp': [{ HostIp: '0.0.0.0', HostPort: String(hostPort) }] },
      Mounts: [
        { Type: 'volume', Source: skilletVolume, Target: '/skillet' },
        { Type: 'volume', Source: 'yeap-shared', Target: '/shared' },
        { Type: 'volume', Source: opencodeVolume, Target: '/root/.local/share/opencode' },
      ],
      RestartPolicy: { Name: 'unless-stopped' },
    },
  }) as unknown as Docker.Container

  await container.start()
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
      `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318`,
      `OPENCODE_CONFIG_CONTENT=${buildOpencodeConfig()}`,
    ],
    HostConfig: {
      NetworkMode: DOCKER_NETWORK,
      PortBindings: { '4096/tcp': [{ HostIp: '0.0.0.0', HostPort: String(hostPort) }] },
      Mounts: [
        { Type: 'volume', Source: skilletVolume, Target: '/skillet' },
        { Type: 'volume', Source: 'yeap-shared', Target: '/shared' },
        { Type: 'volume', Source: opencodeVolume, Target: '/root/.local/share/opencode' },
      ],
      RestartPolicy: { Name: 'unless-stopped' },
    },
  }) as unknown as Docker.Container

  await container.start()
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
