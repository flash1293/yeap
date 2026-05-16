/**
 * Entry point for the yeap agent.
 * Starts the admin server, registers with the orchestrator,
 * connects to the Mattermost WebSocket, and begins processing messages.
 */
import { startAdminServer } from './admin.js'
import { registerBot, buildInitialPrompt } from './register.js'
import { createAgent, triggerPrompt } from './harness.js'
import { startMattermostWebSocket } from './mattermost.js'
import * as tools from './tools/index.js'

const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'

async function main(): Promise<void> {
  console.log(`[agent] Starting ${BOT_NAME}...`)

  // Collect all tools
  const allTools = Object.values(tools)

  // Create the agent (loads session from disk if it exists)
  const agent = await createAgent(allTools)
  console.log(`[agent] Agent created, session has ${agent.state?.messages?.length ?? 0} messages`)

  // Start the admin HTTP server (used by orchestrator for compact/message injection)
  startAdminServer()

  // Register with orchestrator
  const { is_new } = await registerBot()

  // Start Mattermost WebSocket listener
  startMattermostWebSocket((post) => {
    // Build a prompt from the incoming post
    const prompt = formatPostForAgent(post)
    triggerPrompt(prompt)
  })

  // Send initial/restart prompt after a short delay to let WS connect
  await new Promise((r) => setTimeout(r, 3000))

  const initialPrompt = buildInitialPrompt(is_new)
  triggerPrompt(initialPrompt)

  console.log(`[agent] ${BOT_NAME} is ready`)
}

function formatPostForAgent(post: {
  id: string
  channel_id: string
  user_id: string
  message: string
  root_id: string
  channel_name?: string
}): string {
  const isThread = Boolean(post.root_id)
  const replyId = isThread ? post.root_id : post.id
  return [
    `[INCOMING MATTERMOST MESSAGE]`,
    `⚠️ REMINDER: Your text output is invisible. You MUST call reply_to_post to send a response.`,
    `Channel ID: ${post.channel_id}`,
    post.channel_name ? `Channel name: ${post.channel_name}` : '',
    `Post ID: ${post.id}`,
    isThread ? `Thread root ID: ${post.root_id}` : '',
    ``,
    post.message,
    ``,
    `---`,
    `To reply in this thread: call reply_to_post(channel_name="${post.channel_name ?? 'human'}", root_post_id="${replyId}", content="your reply")`,
    `Do NOT output plain text — call the tool or the human will never see your response.`,
  ].filter((l) => l !== '').join('\n')
}

main().catch((err) => {
  console.error('[agent] Fatal error:', err)
  process.exit(1)
})
