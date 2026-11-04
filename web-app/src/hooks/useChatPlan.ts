import { create } from 'zustand'
import { useThreads } from '@/hooks/useThreads'

export const HOME_PLAN_KEY = '__home_plan__'

/** Home is a draft, never a global permission. Durable threads own their mode. */
export const useChatPlan = create<{
  drafts: Record<string, boolean>
  setDraft: (key: string, enabled: boolean) => void
}>((set) => ({
  drafts: {},
  setDraft: (key, enabled) => set((s) => ({ drafts: { ...s.drafts, [key]: enabled } })),
}))

export function chatPlanEnabled(threadId?: string): boolean {
  if (!threadId) return false
  const thread = useThreads.getState().threads[threadId]
  return thread ? thread.metadata?.planMode === true : useChatPlan.getState().drafts[threadId] === true
}

export function setChatPlan(threadId: string, enabled: boolean): void {
  const store = useThreads.getState()
  const thread = store.threads[threadId]
  if (thread) store.updateThread(threadId, { metadata: { ...thread.metadata, planMode: enabled } })
  else useChatPlan.getState().setDraft(threadId, enabled)
}
