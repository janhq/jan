import { create } from 'zustand'
import { useToolApproval } from './useToolApproval'

export type PendingApproval = {
  toolCallId: string
  toolName: string
  threadId: string
  /** MCP server the tool belongs to, so the prompt can offer to trust it. */
  serverName?: string
  resolve: (approved: boolean) => void
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
  resolveApproval: (toolCallId: string, decision: ApprovalDecision) => void
  clearPendingForThread: (threadId: string) => void
}

export const useToolApprovalRequests = create<ToolApprovalRequestsState>()(
  (set, get) => ({
    pending: {},

    requestApproval: (toolCallId, toolName, threadId, serverName) => {
      return new Promise<boolean>((resolve) => {
        const settings = useToolApproval.getState()
        if (settings.allowAllMCPPermissions) {
          resolve(true)
          return
        }
        if (settings.isToolApproved(threadId, toolName, serverName)) {
          resolve(true)
          return
        }
        set((s) => ({
          pending: {
            ...s.pending,
            [toolCallId]: {
              toolCallId,
              toolName,
              threadId,
              serverName,
              resolve,
            },
          },
        }))
      })
    },

    resolveApproval: (toolCallId, decision) => {
      const entry = get().pending[toolCallId]
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
        delete next[toolCallId]
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
        for (const entry of stranded) delete next[entry.toolCallId]
        return { pending: next }
      })
      // Resolve as denied so any awaiting tool loop unblocks instead of hanging.
      for (const entry of stranded) entry.resolve(false)
    },
  })
)
