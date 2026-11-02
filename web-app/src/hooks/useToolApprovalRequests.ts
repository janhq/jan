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

/** Reject/throw to deny an unavailable identity. Called before prompting and granting. */
export type ApprovalValidator = (signal: AbortSignal) => Promise<void>

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
  // Only actionable prompts; validation and callbacks are never persisted.
  pending: Record<string, PendingApproval>

  requestApproval: (
    toolCallId: string,
    toolName: string,
    threadId: string,
    serverName?: string,
    validate?: ApprovalValidator
  ) => Promise<boolean>
  resolveApproval: (toolCallId: string, decision: ApprovalDecision) => void
  cancelApproval: (toolCallId: string) => void
  clearPendingForThread: (threadId: string) => void
}

type InFlightApproval = PendingApproval & {
  validate?: ApprovalValidator
  controller: AbortController
  deciding: boolean
}

export const useToolApprovalRequests = create<ToolApprovalRequestsState>()(
  (set, get) => {
    // Includes validations with no visible prompt, so cancellation can invalidate
    // their continuations. Object identity also protects reused tool-call IDs.
    const inFlight = new Map<string, InFlightApproval>()
    const isCurrent = (entry: InFlightApproval) =>
      inFlight.get(entry.toolCallId) === entry
    const removePrompt = (entry: InFlightApproval) => {
      if (get().pending[entry.toolCallId] !== entry) return
      set((s) => {
        const next = { ...s.pending }
        delete next[entry.toolCallId]
        return { pending: next }
      })
    }
    const finish = (entry: InFlightApproval, approved: boolean) => {
      if (!isCurrent(entry)) return
      inFlight.delete(entry.toolCallId)
      entry.controller.abort()
      removePrompt(entry)
      entry.resolve(approved)
    }

    return {
      pending: {},

      requestApproval: (toolCallId, toolName, threadId, serverName, validate) => {
        const previous = inFlight.get(toolCallId)
        if (previous) finish(previous, false)
        return new Promise<boolean>((resolve) => {
          const entry: InFlightApproval = {
            toolCallId, toolName, threadId, serverName, resolve, validate,
            deciding: false, controller: new AbortController(),
          }
          inFlight.set(toolCallId, entry)
          const publish = () => {
            if (!isCurrent(entry)) return
            const settings = useToolApproval.getState()
            if (settings.allowAllMCPPermissions ||
                settings.isToolApproved(threadId, toolName, serverName)) {
              finish(entry, true)
              return
            }
            set((s) => ({ pending: { ...s.pending, [toolCallId]: entry } }))
          }
          // Preserve synchronous prompting/auto-approval for existing callers.
          if (!validate) publish()
          else {
            void (async () => {
              try {
                await validate(entry.controller.signal)
                publish()
              } catch {
                finish(entry, false)
              }
            })()
          }
        })
      },

      resolveApproval: (toolCallId, decision) => {
        const entry = inFlight.get(toolCallId)
        if (!entry) return
        // Denial wins even while an earlier allow decision is validating.
        if (decision === 'deny') {
          finish(entry, false)
          return
        }
        if (entry.deciding || get().pending[toolCallId] !== entry) return
        entry.deciding = true
        removePrompt(entry)
        const grant = () => {
          if (!isCurrent(entry)) return
          // Consume before persistence: synchronous store subscribers cannot
          // race another decision or resurrect this request.
          inFlight.delete(toolCallId)
          const approval = useToolApproval.getState()
          if (decision === 'allow-thread') {
            approval.approveToolForThread(entry.threadId, entry.toolName, entry.serverName)
          } else if (decision === 'allow-always') {
            if (entry.serverName) approval.approveServer(entry.serverName)
            else approval.approveToolEverywhere(entry.toolName)
          }
          entry.resolve(true)
        }
        if (!entry.validate) grant()
        else {
          void (async () => {
            try {
              await entry.validate!(entry.controller.signal)
              grant()
            } catch {
              finish(entry, false)
            }
          })()
        }
      },

      cancelApproval: (toolCallId) => {
        const entry = inFlight.get(toolCallId)
        if (entry) finish(entry, false)
      },

      clearPendingForThread: (threadId) => {
        for (const entry of inFlight.values()) {
          if (entry.threadId === threadId) finish(entry, false)
        }
      },
    }
  }
)
