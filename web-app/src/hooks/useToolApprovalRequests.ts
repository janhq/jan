import { create } from 'zustand'
import { useToolApproval } from './useToolApproval'
import { approvalRequestKey } from '@/lib/tool-approval-key'

export type PendingApproval = {
  toolCallId: string
  toolName: string
  threadId: string
  /** MCP server the tool belongs to, so the prompt can offer to trust it. */
  serverName?: string
  resolve: (approved: boolean) => void
  promise: Promise<boolean>
}

/**
 * Scope of the grant. `allow-always` trusts the tool's whole server when it has
 * one, since trusting a server tool-by-tool is the same decision repeated.
 */
export type ApprovalDecision =
  | 'allow-once'
  | 'allow-thread'
  | 'allow-always'
  | 'deny'

type ToolApprovalRequestsState = {
  // In-flight per-tool-call approval prompts. Kept out of the persisted
  // useToolApproval store so approval churn never flushes to disk (the
  // resolve callbacks are non-serializable anyway).
  pending: Record<string, PendingApproval>

  requestApproval: (
    toolCallId: string,
    toolName: string,
    threadId: string,
    serverName?: string
  ) => Promise<boolean>
  resolveApproval: (toolCallId: string, decision: ApprovalDecision, threadId?: string) => void
  clearPendingForThread: (threadId: string) => void
}

export const useToolApprovalRequests = create<ToolApprovalRequestsState>()(
  (set, get) => ({
    pending: {},

    requestApproval: (toolCallId, toolName, threadId, serverName) => {
      const key = approvalRequestKey(threadId, toolCallId)
      const existing = get().pending[key]
      if (existing) {
        return existing.toolName === toolName && existing.serverName === serverName
          ? existing.promise : Promise.resolve(false)
      }
      const settings = useToolApproval.getState()
      if (settings.allowAllMCPPermissions || settings.isToolApproved(threadId, toolName, serverName)) {
        return Promise.resolve(true)
      }
      let resolve!: (approved: boolean) => void
      const promise = new Promise<boolean>((settle) => { resolve = settle })
      set((s) => ({
        pending: { ...s.pending, [key]: { toolCallId, toolName, threadId, serverName, resolve, promise } },
      }))
      return promise
    },

    resolveApproval: (toolCallId, decision, threadId) => {
      const pending = get().pending
      const matches = threadId ? [approvalRequestKey(threadId, toolCallId)]
        : Object.keys(pending).filter((key) => pending[key].toolCallId === toolCallId)
      // Compatibility for callers without an owner is safe only if unique.
      if (matches.length !== 1) return
      const key = matches[0]
      const entry = pending[key]
      if (!entry) return
      const approval = useToolApproval.getState()
      if (decision === 'allow-thread') {
        approval.approveToolForThread(entry.threadId, entry.toolName)
      } else if (decision === 'allow-always') {
        if (entry.serverName) {
          approval.approveServer(entry.serverName)
        } else {
          approval.approveToolEverywhere(entry.toolName)
        }
      }
      set((s) => {
        const next = { ...s.pending }
        delete next[key]
        return { pending: next }
      })
      entry.resolve(decision !== 'deny')
    },

    clearPendingForThread: (threadId) => {
      const { pending } = get()
      const stranded = Object.values(pending).filter(
        (entry) => entry.threadId === threadId
      )
      if (stranded.length === 0) return
      set((s) => {
        const next = { ...s.pending }
        for (const entry of stranded) delete next[approvalRequestKey(entry.threadId, entry.toolCallId)]
        return { pending: next }
      })
      // Resolve as denied so any awaiting tool loop unblocks instead of hanging.
      for (const entry of stranded) entry.resolve(false)
    },
  })
)
