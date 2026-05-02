import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type NotificationsStore = {
  /** Topics for which notifications are explicitly muted. All others are ON. */
  muted: Record<string, boolean>
  isMuted: (topicId: string) => boolean
  toggle: (topicId: string) => void
}

export const useNotificationsStore = create<NotificationsStore>()(
  persist(
    (set, get) => ({
      muted: {},
      isMuted: (topicId) => get().muted[topicId] ?? false,
      toggle: (topicId) =>
        set((s) => ({
          muted: { ...s.muted, [topicId]: !s.muted[topicId] },
        })),
    }),
    { name: 'yeap-notifications' },
  ),
)
