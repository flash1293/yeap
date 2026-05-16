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
  startMattermostWebSocket(async (post) => {
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
}): string {
  const isThread = Boolean(post.root_id)
  return [
    `[INCOMING MATTERMOST MESSAGE]`,
    `Channel ID: ${post.channel_id}`,
    `Post ID: ${post.id}`,
    isThread ? `Thread root ID: ${post.root_id}` : '',
    ``,
    post.message,
    ``,
    `---`,
    `To reply in a thread: use reply_to_post with channel_name and root_post_id="${isThread ? post.root_id : post.id}"`,
    `To post to a channel by name: first look up the channel, then use post_to_channel`,
  ].filter((l) => l !== '').join('\n')
}

main().catch((err) => {
  console.error('[agent] Fatal error:', err)
  process.exit(1)
})
