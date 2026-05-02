import type { Plugin } from '@opencode-ai/plugin'
import { registerBot } from './register.js'
import { startWatcher } from './watcher.js'
import * as tools from './tools/index.js'
import { createOtelHooks } from './otel.js'

export const YeapPlugin: Plugin = async (input) => {
  // Defer registration to avoid deadlock: the server finishes initializing
  // session routes *after* plugins are loaded, so calling client.session.create
  // here would deadlock. Fire-and-forget with retry gives the server time to
  // be ready before we attempt registration.
  void scheduleRegistration(input.client)

  return {
    tool: tools,
    ...createOtelHooks(),
  }
}

async function scheduleRegistration(
  client: Parameters<Plugin>[0]['client'],
): Promise<void> {
  // Wait for the server to finish loading all routes before making SDK calls
  await new Promise((resolve) => setTimeout(resolve, 3000))

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await registerBot(client)
      // Registration succeeded — start watching for incoming messages
      startWatcher()
      return
    } catch (err) {
      console.error(`[yeap-plugin] registerBot attempt ${attempt} failed:`, err)
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000))
    }
  }
}
