import { Hono } from 'hono'
import { ssebus } from '../sse.js'
import { streamSSE } from 'hono/streaming'

export const eventsRouter = new Hono()

eventsRouter.get('/', (c) => {
  return streamSSE(c, async (stream) => {
    const writer = {
      write: (data: string) => {
        stream.write(data).catch(() => ssebus.remove(writer))
      },
      close: () => {
        ssebus.remove(writer)
      },
    }

    ssebus.add(writer)

    // Send initial connected ping
    await stream.write('data: {"type":"connected"}\n\n')

    // Keep alive until client disconnects
    await new Promise<void>((resolve) => {
      c.req.raw.signal.addEventListener('abort', () => {
        ssebus.remove(writer)
        resolve()
      })
    })
  })
})
