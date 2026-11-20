import { create } from 'zustand'

/** Diagnostics for one failed load, and the model that failed. */
export type LoadReport = {
  text: string
  /**
   * The model of the turn that failed, not whichever is selected now. A
   * message is read long after the user has moved on, and a check offered
   * from it has to be a check of the model it is reporting on.
   */
  model?: string
}

type MessageErrorsState = {
  errors: Record<string, string>
  /** Paste-ready diagnostics for a failed model load, by message id. */
  reports: Record<string, LoadReport>
  setError: (messageId: string, error: string) => void
  setReport: (messageId: string, report: string, model?: string) => void
  clearError: (messageId: string) => void
  clearAll: () => void
  hydrate: (entries: Record<string, string>) => void
}

export const useMessageErrors = create<MessageErrorsState>()((set) => ({
  errors: {},
  reports: {},
  setReport: (messageId, report, model) =>
    set((state) => ({
      reports: { ...state.reports, [messageId]: { text: report, model } },
    })),
  setError: (messageId, error) =>
    set((state) => {
      if (state.errors[messageId] === error) return state
      // A different error on the same message: the old report describes the
      // old failure, and the new one may have no diagnostics at all, so it
      // must not be left behind offering stale advice.
      const reports = { ...state.reports }
      delete reports[messageId]
      return { errors: { ...state.errors, [messageId]: error }, reports }
    }),
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
