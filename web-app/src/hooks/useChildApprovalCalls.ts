import { create } from 'zustand'

/**
 * Route-owned registry of the tool-call ids a `task` child has in flight, per
 * thread. The route registers a child call before its first await and removes
 * it in `finally`, so this is the explicit, reliable source for which pending
 * approvals belong to children. It deliberately lives beside, not inside, the
 * shared approval store: parent calls are never registered here, so they are
 * never rendered twice.
 */
type ChildApprovalCallsState = {
  inputs: Record<string, Record<string, unknown>>
  owned: Record<string, readonly string[]>
  register: (threadId: string, callId: string, input?: unknown) => void
  release: (threadId: string, callId: string) => void
  clearThread: (threadId: string) => void
}

export const useChildApprovalCalls = create<ChildApprovalCallsState>()((set) => ({
  owned: {},
  inputs: {},
  register: (threadId, callId, input) =>
    set((s) => {
      const current = s.owned[threadId] ?? []
      if (current.includes(callId)) return s
      return { owned: { ...s.owned, [threadId]: [...current, callId] }, inputs: { ...s.inputs, [threadId]: { ...s.inputs[threadId], [callId]: input } } }
    }),
  release: (threadId, callId) =>
    set((s) => {
      const current = s.owned[threadId]
      if (!current?.includes(callId)) return s
      const next = current.filter((id) => id !== callId)
      const owned = { ...s.owned }
      if (next.length) owned[threadId] = next
      else delete owned[threadId]
      const inputs = { ...s.inputs, [threadId]: { ...s.inputs[threadId] } }
      delete inputs[threadId][callId]
      if (!Object.keys(inputs[threadId]).length) delete inputs[threadId]
      return { owned, inputs }
    }),
  clearThread: (threadId) =>
    set((s) => {
      if (!(threadId in s.owned)) return s
      const owned = { ...s.owned }
      delete owned[threadId]
      const inputs = { ...s.inputs }
      delete inputs[threadId]
      return { owned, inputs }
    }),
}))
