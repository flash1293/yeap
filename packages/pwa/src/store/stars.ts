import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type StarsStore = {
  starred: string[]
  toggle: (path: string) => void
  isStarred: (path: string) => boolean
}

export const useStarsStore = create<StarsStore>()(
  persist(
    (set, get) => ({
      starred: [],
      toggle: (path) =>
        set((s) =>
          s.starred.includes(path)
            ? { starred: s.starred.filter((p) => p !== path) }
            : { starred: [...s.starred, path] },
        ),
      isStarred: (path) => get().starred.includes(path),
    }),
    { name: 'yeap-stars' },
  ),
)
