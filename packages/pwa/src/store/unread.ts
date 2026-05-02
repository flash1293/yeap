import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type UnreadStore = {
  counts: Record<string, number>
  increment: (topicId: string) => void
  clear: (topicId: string) => void
  clearAll: () => void
}

export const useUnreadStore = create<UnreadStore>()(
  persist(
    (set) => ({
      counts: {},
      increment: (topicId) =>
        set((s) => ({
          counts: { ...s.counts, [topicId]: (s.counts[topicId] ?? 0) + 1 },
        })),
      clear: (topicId) =>
        set((s) => {
          const next = { ...s.counts }
          delete next[topicId]
          return { counts: next }
        }),
      clearAll: () => set({ counts: {} }),
    }),
    { name: 'yeap-unread' },
  ),
)
