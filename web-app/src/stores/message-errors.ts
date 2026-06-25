import { create } from 'zustand'

type MessageErrorsState = {
  errors: Record<string, string>
  setError: (messageId: string, error: string) => void
  clearError: (messageId: string) => void
  clearAll: () => void
  hydrate: (entries: Record<string, string>) => void
}

export const useMessageErrors = create<MessageErrorsState>()((set) => ({
  errors: {},
  setError: (messageId, error) =>
    set((state) =>
      state.errors[messageId] === error
        ? state
        : { errors: { ...state.errors, [messageId]: error } }
    ),
  clearError: (messageId) =>
    set((state) => {
      if (!(messageId in state.errors)) return state
      const rest = { ...state.errors }
      delete rest[messageId]
      return { errors: rest }
    }),
  clearAll: () => set({ errors: {} }),
  hydrate: (entries) => set({ errors: entries }),
}))
