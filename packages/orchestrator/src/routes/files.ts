import { Hono } from 'hono'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { requireAuth } from '../middleware/auth.js'
import { docker, containerName } from '../services/docker.js'
import { db } from '../db/index.js'
import { bots } from '../db/schema.js'
import { SHARED_ROOT } from '@yeap/shared'

const MAX_BYTES = 1_048_576 // 1 MB read limit

export type FileEntry = { name: string; type: 'file' | 'dir'; size: number }

export const filesRouter = new Hono()

filesRouter.use('*', requireAuth)

// ── Path resolution ───────────────────────────────────────────────────────────

type Resolved =
  | { kind: 'root' }
  | { kind: 'bots-root' }
  | { kind: 'shared'; absPath: string }
  | { kind: 'bot'; cname: string; containerPath: string }

function parseVirtual(raw: string): Resolved | null {
  const parts = raw
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)

  if (parts.length === 0) return { kind: 'root' }

  const [root, ...rest] = parts as [string, ...string[]]

  if (root === 'shared') {
    const sub = rest.join('/')
    const abs = resolve(join(SHARED_ROOT, sub))
    if (abs !== SHARED_ROOT && !abs.startsWith(SHARED_ROOT + '/')) return null
    return { kind: 'shared', absPath: abs }
  }

  if (root === 'bots') {
    if (rest.length === 0) return { kind: 'bots-root' }
    const [botName, ...deeper] = rest as [string, ...string[]]
    if (!botName) return null
    // Validate bot name matches the allowed pattern
    if (!/^[a-zA-Z0-9][a-zA-Z0-9 \-]{0,30}[a-zA-Z0-9]$|^[a-zA-Z0-9]{1,2}$/.test(botName)) return null
    const subPath = deeper.join('/')
    const containerPath = resolve(join('/skillet', subPath))
    if (containerPath !== '/skillet' && !containerPath.startsWith('/skillet/')) return null
    return { kind: 'bot', cname: containerName(botName), containerPath }
  }

  return null
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

// GET /files/ls?path=<virtual>
filesRouter.get('/ls', async (c) => {
  const rawPath = c.req.query('path') ?? ''
  const resolved = parseVirtual(rawPath)
  if (!resolved) return c.json({ error: 'Invalid path' }, 400)

  if (resolved.kind === 'root') {
    return c.json({
      entries: [
        { name: 'shared', type: 'dir', size: 0 },
        { name: 'bots', type: 'dir', size: 0 },
      ] as FileEntry[],
    })
  }

  if (resolved.kind === 'bots-root') {
    const allBots = db.select().from(bots).all()
    const entries: FileEntry[] = allBots.map((b) => ({ name: b.name, type: 'dir', size: 0 }))
    return c.json({ entries })
  }

  if (resolved.kind === 'shared') {
    if (!existsSync(resolved.absPath)) return c.json({ error: 'Not found' }, 404)
    try {
      const entries: FileEntry[] = readdirSync(resolved.absPath)
        .map((name) => {
          try {
            const s = statSync(join(resolved.absPath, name))
            return { name, type: s.isDirectory() ? 'dir' : 'file', size: s.size } as FileEntry
          } catch {
            return null
          }
        })
        .filter((e): e is FileEntry => e !== null)
      return c.json({ entries })
    } catch {
      return c.json({ error: 'Not found' }, 404)
    }
  }

  // bot — docker exec
  const entries = await dockerLs(resolved.cname, resolved.containerPath)
  return c.json({ entries })
})

// GET /files/read?path=<virtual>
filesRouter.get('/read', async (c) => {
  const rawPath = c.req.query('path') ?? ''
  const resolved = parseVirtual(rawPath)
  if (!resolved) return c.json({ error: 'Invalid path' }, 400)
  if (resolved.kind === 'root' || resolved.kind === 'bots-root') {
    return c.json({ error: 'Cannot read a directory' }, 400)
  }

  if (resolved.kind === 'shared') {
    if (!existsSync(resolved.absPath)) return c.json({ error: 'Not found' }, 404)
    try {
      const s = statSync(resolved.absPath)
      if (s.isDirectory()) return c.json({ error: 'Is a directory' }, 400)
      if (s.size > MAX_BYTES) {
        return c.json({ content: `[File too large to display (${(s.size / 1024).toFixed(0)} KB)]` })
      }
      const content = readFileSync(resolved.absPath, 'utf8')
      return c.json({ content })
    } catch {
      return c.json({ error: 'Not found' }, 404)
    }
  }

  // bot — docker exec
  const content = await dockerRead(resolved.cname, resolved.containerPath)
  if (content === null) return c.json({ error: 'Not found' }, 404)
  return c.json({ content })
})

// ── Docker exec helpers ───────────────────────────────────────────────────────

async function dockerExecOutput(cname: string, cmd: string[]): Promise<string> {
  const container = docker.getContainer(cname)
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: false,
    Tty: false,
  })
  const stream = await exec.start({ hijack: true, stdin: false })

  const stdout = new PassThrough()
  const chunks: Buffer[] = []
  stdout.on('data', (c: Buffer) => chunks.push(c))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(docker.modem as any).demuxStream(stream, stdout, new PassThrough())

  return new Promise((resolve, reject) => {
    stream.on('end', () => {
      stdout.end()
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    stream.on('error', reject)
  })
}

async function dockerLs(cname: string, path: string): Promise<FileEntry[]> {
  const script =
    "const fs=require('fs'),p=require('path');" +
    "try{" +
    "const d=process.argv[1];" +
    "const e=fs.readdirSync(d).map(n=>{" +
    "try{const s=fs.statSync(p.join(d,n));return{name:n,type:s.isDirectory()?'dir':'file',size:s.size}}" +
    "catch{return null}}).filter(Boolean);" +
    "process.stdout.write(JSON.stringify(e));" +
    "}catch(err){process.stdout.write(JSON.stringify([]))}"
  try {
    const raw = await dockerExecOutput(cname, ['node', '-e', script, path])
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as FileEntry[]) : []
  } catch {
    return []
  }
}

async function dockerRead(cname: string, path: string): Promise<string | null> {
  const script =
    "const fs=require('fs');" +
    "try{" +
    "const d=fs.readFileSync(process.argv[1]);" +
    `if(d.length>${MAX_BYTES}){process.stdout.write('[File too large (>1MB)]');}` +
    "else{process.stdout.write(d.toString('utf8'));}" +
    "}catch(err){process.stdout.write('[Error: '+err.message+']');}"
  try {
    return await dockerExecOutput(cname, ['node', '-e', script, path])
  } catch {
    return null
  }
}
