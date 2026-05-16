import { Type } from '@sinclair/typebox'
import { simpleGit } from 'simple-git'
import { getChannelByName, postToChannel } from '../mattermost.js'
import type { AgentTool } from '@earendil-works/pi-agent-core'

const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'
const WORK_ROOT = '/shared/work'

function makeGit() {
  return simpleGit(WORK_ROOT).env({
    GIT_AUTHOR_NAME: BOT_NAME,
    GIT_AUTHOR_EMAIL: `${BOT_NAME.toLowerCase().replace(/\s+/g, '.')}@yeap.local`,
    GIT_COMMITTER_NAME: BOT_NAME,
    GIT_COMMITTER_EMAIL: `${BOT_NAME.toLowerCase().replace(/\s+/g, '.')}@yeap.local`,
  })
}

const gitPullParams = Type.Object({})

export const git_pull_work: AgentTool<typeof gitPullParams> = {
  name: 'git_pull_work',
  label: 'Git Pull Work',
  description: 'Pull the latest changes from /shared/work/. Always call before reading files you plan to modify.',
  parameters: gitPullParams,
  execute: async () => {
    try {
      const git = makeGit()
      const result = await git.pull()
      const s = result.summary
      return {
        content: [{ type: 'text' as const, text: `Pulled. ${s.changes} changes, ${s.insertions} insertions, ${s.deletions} deletions.` }],
        details: {},
      }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `git pull failed: ${String(err)}` }], details: {} }
    }
  },
}

const gitCommitParams = Type.Object({
  message: Type.String({ description: 'Commit message' }),
})

export const git_commit_work: AgentTool<typeof gitCommitParams> = {
  name: 'git_commit_work',
  label: 'Git Commit Work',
  description: 'Stage all changes in /shared/work/ and commit. Pulls first. Posts a message to the "conflicts" channel if merge conflict occurs.',
  parameters: gitCommitParams,
  execute: async (_id, params) => {
    const git = makeGit()
    try {
      await git.pull()
    } catch (err: unknown) {
      const errMsg = String(err)
      if (errMsg.includes('CONFLICT') || errMsg.includes('Automatic merge failed')) {
        await postConflictAlert(errMsg)
        return {
          content: [{ type: 'text' as const, text: 'Merge conflict detected. Alert posted to #conflicts channel.' }],
          details: {},
        }
      }
      return { content: [{ type: 'text' as const, text: `git pull failed: ${errMsg}` }], details: {} }
    }
    try {
      const status = await git.status()
      if (status.isClean()) return { content: [{ type: 'text' as const, text: 'Nothing to commit.' }], details: {} }
      await git.add('.')
      await git.commit(params.message)
      return { content: [{ type: 'text' as const, text: `Committed: ${params.message}` }], details: {} }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `git commit failed: ${String(err)}` }], details: {} }
    }
  },
}

async function postConflictAlert(errMsg: string): Promise<void> {
  const content = [
    `## Merge Conflict`,
    ``,
    `Bot **${BOT_NAME}** encountered a merge conflict in \`/shared/work/\`.`,
    `\`\`\``,
    errMsg.slice(0, 500),
    `\`\`\``,
    `Please reply with a resolution plan.`,
  ].join('\n')

  const channel = await getChannelByName('conflicts')
  if (channel) {
    await postToChannel(channel.id, content)
  }
}
