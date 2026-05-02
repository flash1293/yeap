import { tool } from '@opencode-ai/plugin'
import { simpleGit } from 'simple-git'
import { WORK_ROOT, buildMessagePath } from '@yeap/shared'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'

function makeGit() {
  return simpleGit(WORK_ROOT).env({
    GIT_AUTHOR_NAME: BOT_NAME,
    GIT_AUTHOR_EMAIL: `${BOT_NAME.toLowerCase().replace(/\s+/g, '.')}@yeap.local`,
    GIT_COMMITTER_NAME: BOT_NAME,
    GIT_COMMITTER_EMAIL: `${BOT_NAME.toLowerCase().replace(/\s+/g, '.')}@yeap.local`,
  })
}

export const git_pull_work = tool({
  description: 'Pull the latest changes from /shared/work/. Always call before reading files you plan to modify.',
  args: {},
  async execute() {
    try {
      const git = makeGit()
      const result = await git.pull()
      const summary = result.summary
      return `Pulled. ${summary.changes} changes, ${summary.insertions} insertions, ${summary.deletions} deletions.`
    } catch (err) {
      return `git pull failed: ${String(err)}`
    }
  },
})

export const git_commit_work = tool({
  description:
    'Stage all changes in /shared/work/ and commit. Pulls first. If a merge conflict occurs, writes a message to the "conflicts" topic and returns an error.',
  args: {
    message: tool.schema.string('Commit message.'),
  },
  async execute({ message }) {
    const git = makeGit()

    // Pull first
    try {
      await git.pull()
    } catch (err: unknown) {
      const errMsg = String(err)
      if (errMsg.includes('CONFLICT') || errMsg.includes('Automatic merge failed')) {
        // Write conflict message to FSAD
        await writeConflictMessage(git, errMsg)
        return (
          `Merge conflict detected. A message has been written to the 'conflicts' topic. ` +
          `Resolve the conflict with the other author before retrying.`
        )
      }
      return `git pull failed: ${errMsg}`
    }

    try {
      const status = await git.status()
      if (status.isClean()) return 'Nothing to commit.'
      await git.add('.')
      await git.commit(message)
      return `Committed: ${message}`
    } catch (err) {
      return `git commit failed: ${String(err)}`
    }
  },
})

async function writeConflictMessage(git: ReturnType<typeof simpleGit>, errMsg: string): Promise<void> {
  let conflicting_authors = 'unknown'
  try {
    const log = await git.log(['--merges', '-1'])
    const entry = log.latest
    if (entry?.author_name) conflicting_authors = entry.author_name
  } catch {
    // best effort
  }

  const content = [
    `## Merge Conflict`,
    ``,
    `Bot \`${BOT_NAME}\` encountered a merge conflict in \`/shared/work/\`.`,
    ``,
    `Likely conflicting with: ${conflicting_authors}`,
    ``,
    `\`\`\``,
    errMsg.slice(0, 500),
    `\`\`\``,
    ``,
    `Please reply with a resolution plan.`,
  ].join('\n')

  const msg_path = buildMessagePath('conflicts', BOT_NAME)
  mkdirSync(msg_path, { recursive: true })
  writeFileSync(join(msg_path, 'content.txt'), content, 'utf8')
  writeFileSync(join(msg_path, 'meta.json'), JSON.stringify({ type: 'alert' }), 'utf8')
}
