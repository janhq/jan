import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { LOCAL_STORAGE_KEY } from '@/constants'

interface PrivateChatState {
  isPrivateChat: boolean
  setIsPrivateChat: (isPrivate: boolean) => void
}

export const usePrivateChat = create<PrivateChatState>()(
  persist(
    (set) => ({
      isPrivateChat: false,
      setIsPrivateChat: (isPrivate: boolean) =>
        set({ isPrivateChat: isPrivate }),
    }),
    {
      name: LOCAL_STORAGE_KEY.PRIVATE_CHAT,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
