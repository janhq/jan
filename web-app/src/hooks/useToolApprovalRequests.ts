import { create } from 'zustand'
import { useToolApproval } from './useToolApproval'

export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny'

export type PendingApproval = {
  toolCallId: string
  toolName: string
  threadId: string
  onDecision: (decision: ApprovalDecision) => void
}

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
  // Registers a prompt whose resolution is driven by the caller (Code UI's
  // own Rust-side permission flow, via `agent_permission_respond`) rather
  // than the chat auto-approve settings `requestApproval` consults — the
  // caller already decided a prompt is needed before calling this.
  registerPending: (
    toolCallId: string,
    toolName: string,
    threadId: string,
    onDecision: (decision: ApprovalDecision) => void
  ) => void
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
              onDecision: (decision) => resolve(decision !== 'deny'),
            },
          },
        }))
      })
    },

    registerPending: (toolCallId, toolName, threadId, onDecision) => {
      set((s) => ({
        pending: {
          ...s.pending,
          [toolCallId]: { toolCallId, toolName, threadId, onDecision },
        },
      }))
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
      entry.onDecision(decision)
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
      for (const entry of stranded) entry.onDecision('deny')
    },
  })
)
