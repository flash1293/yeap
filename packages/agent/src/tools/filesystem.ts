import { Type } from '@sinclair/typebox'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AgentTool } from '@earendil-works/pi-agent-core'

const execAsync = promisify(exec)

const bashParams = Type.Object({
  command: Type.String({ description: 'Shell command to execute' }),
  timeout_seconds: Type.Optional(Type.Number({ description: 'Timeout in seconds (default: 30)' })),
})

export const bash: AgentTool<typeof bashParams> = {
  name: 'bash',
  label: 'Bash',
  description: 'Execute a shell command. Returns stdout and stderr.',
  parameters: bashParams,
  executionMode: 'sequential',
  execute: async (_id, params) => {
    const timeoutMs = (params.timeout_seconds ?? 30) * 1000
    try {
      const { stdout, stderr } = await execAsync(params.command, {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      })
      const result = [stdout, stderr].filter(Boolean).join('\n').slice(0, 8192)
      return { content: [{ type: 'text' as const, text: result || '(no output)' }], details: {} }
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string }
      const result = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').slice(0, 8192)
      return { content: [{ type: 'text' as const, text: result || String(err) }], details: {} }
    }
  },
}

const readFileParams = Type.Object({
  path: Type.String({ description: 'Absolute file path to read' }),
  start_line: Type.Optional(Type.Number({ description: 'First line to read (1-based)' })),
  end_line: Type.Optional(Type.Number({ description: 'Last line to read (1-based, inclusive)' })),
})

export const read_file: AgentTool<typeof readFileParams> = {
  name: 'read_file',
  label: 'Read File',
  description: 'Read a file. Optionally specify start_line and end_line (1-based).',
  parameters: readFileParams,
  execute: async (_id, params) => {
    if (!existsSync(params.path)) {
      return { content: [{ type: 'text' as const, text: `File not found: ${params.path}` }], details: {} }
    }
    let content = readFileSync(params.path, 'utf8')
    if (params.start_line !== undefined || params.end_line !== undefined) {
      const lines = content.split('\n')
      const start = (params.start_line ?? 1) - 1
      const end = params.end_line ?? lines.length
      content = lines.slice(start, end).join('\n')
    }
    return { content: [{ type: 'text' as const, text: content.slice(0, 32768) }], details: {} }
  },
}

const writeFileParams = Type.Object({
  path: Type.String({ description: 'Absolute file path to write' }),
  content: Type.String({ description: 'Content to write' }),
})

export const write_file: AgentTool<typeof writeFileParams> = {
  name: 'write_file',
  label: 'Write File',
  description: 'Write content to a file, creating it and its parent directories if needed.',
  parameters: writeFileParams,
  executionMode: 'sequential',
  execute: async (_id, params) => {
    mkdirSync(dirname(params.path), { recursive: true })
    writeFileSync(params.path, params.content, 'utf8')
    return { content: [{ type: 'text' as const, text: `Written: ${params.path}` }], details: {} }
  },
}

const editFileParams = Type.Object({
  path: Type.String({ description: 'Absolute file path to edit' }),
  old_string: Type.String({ description: 'Exact string to replace (must appear exactly once)' }),
  new_string: Type.String({ description: 'Replacement string' }),
})

export const edit_file: AgentTool<typeof editFileParams> = {
  name: 'edit_file',
  label: 'Edit File',
  description: 'Replace an exact string in a file with a new string. The old_string must match exactly.',
  parameters: editFileParams,
  executionMode: 'sequential',
  execute: async (_id, params) => {
    if (!existsSync(params.path)) {
      return { content: [{ type: 'text' as const, text: `File not found: ${params.path}` }], details: {} }
    }
    const content = readFileSync(params.path, 'utf8')
    const count = content.split(params.old_string).length - 1
    if (count === 0) {
      return { content: [{ type: 'text' as const, text: `old_string not found in ${params.path}` }], details: {} }
    }
    if (count > 1) {
      return { content: [{ type: 'text' as const, text: `old_string appears ${count} times — must be unique` }], details: {} }
    }
    writeFileSync(params.path, content.replace(params.old_string, params.new_string), 'utf8')
    return { content: [{ type: 'text' as const, text: `Edited: ${params.path}` }], details: {} }
  },
}
