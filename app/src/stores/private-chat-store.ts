import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface LastUsedModelState {
  isPrivateChat: boolean
  setIsPrivateChat: (isPrivate: boolean) => void
}

export const usePrivateChat = create<LastUsedModelState>()(
  persist(
    (set) => ({
      isPrivateChat: false,
      setIsPrivateChat: (isPrivate: boolean) =>
        set({ isPrivateChat: isPrivate }),
    }),
    {
      name: 'private-chat-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
