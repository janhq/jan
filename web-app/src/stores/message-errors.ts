import { create } from 'zustand'

type MessageErrorsState = {
  errors: Record<string, string>
  /** Paste-ready diagnostics for a failed model load, by message id. */
  reports: Record<string, string>
  setError: (messageId: string, error: string) => void
  setReport: (messageId: string, report: string) => void
  clearError: (messageId: string) => void
  clearAll: () => void
  hydrate: (entries: Record<string, string>) => void
}

export const useMessageErrors = create<MessageErrorsState>()((set) => ({
  errors: {},
  reports: {},
  setReport: (messageId, report) =>
    set((state) => ({ reports: { ...state.reports, [messageId]: report } })),
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
      const reports = { ...state.reports }
      delete reports[messageId]
      return { errors: rest, reports }
    }),
  clearAll: () => set({ errors: {}, reports: {} }),
  hydrate: (entries) => set({ errors: entries, reports: {} }),
}))
