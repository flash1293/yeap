import type { FsadEvent } from '@yeap/shared'

type SseWriter = {
  write: (data: string) => void
  close: () => void
}

const clients = new Set<SseWriter>()

export const ssebus = {
  add(writer: SseWriter) {
    clients.add(writer)
  },
  remove(writer: SseWriter) {
    clients.delete(writer)
  },
  broadcast(event: FsadEvent) {
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const writer of clients) {
      try {
        writer.write(payload)
      } catch {
        clients.delete(writer)
      }
    }
  },
}
