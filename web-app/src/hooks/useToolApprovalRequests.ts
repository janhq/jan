import { create } from 'zustand'
import {
  consentAnswer,
  consentCancelThread,
  consentRequest,
  type ToolOrigin,
} from '@janhq/tauri-plugin-agent-tools-api'

export type PendingApproval = {
  toolCallId: string
  toolName: string
  threadId: string
  /** MCP server the tool belongs to, so the prompt can offer to trust it. */
  serverName?: string
  /** Asked for this call alone; see `ApprovalOptions.strict`. */
  strict?: boolean
  /** See `ApprovalOptions.origin`. */
  extension: boolean
  resolve: (approved: boolean) => void
}

export type ApprovalOptions = {
  /**
   * Ask, whatever "allow all MCP" or a saved grant says, and save no grant
   * from the answer. For a call made by a model an extension serves
   * (janhq/jan-internal#517): grants were given to the user's own models,
   * and must not cover one that can send the extension's data anywhere. And
   * for a built-in call that changes a folder attached to the chat.
   */
  strict?: boolean
  /**
   * Who serves the tool, as the caller resolved it. Only the caller can
   * know: an MCP server the user named `ext:<id>` can expose a tool with
   * the extension's exact wire name, so neither name tells them apart.
   * Absent means MCP, so nothing is ever let in as an extension's by
   * accident.
   */
  origin?: ToolOrigin
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
  // In-flight per-tool-call approval prompts. The grants and the one-use
  // authorization each answer gives live in Rust (agent-tools `consent`);
  // the executors refuse a call it did not authorize.
  pending: Record<string, PendingApproval>

  requestApproval: (
    toolCallId: string,
    toolName: string,
    threadId: string,
    serverName?: string,
    options?: ApprovalOptions
  ) => Promise<boolean>
  resolveApproval: (toolCallId: string, decision: ApprovalDecision) => void
  clearPendingForThread: (threadId: string) => void
}

export const useToolApprovalRequests = create<ToolApprovalRequestsState>()(
  (set, get) => ({
    pending: {},

    requestApproval: async (
      toolCallId,
      toolName,
      threadId,
      serverName,
      options
    ) => {
      const strict = options?.strict ?? false
      const origin = options?.origin ?? 'mcp'
      // A store that cannot be reached cannot authorize anything: denied.
      const verdict = await consentRequest({
        threadId,
        callId: toolCallId,
        tool: toolName,
        server: serverName,
        origin,
        strict,
      }).catch((error) => {
        console.error('Tool approval request failed:', error)
        return null
      })
      if (verdict === 'allowed') return true
      if (verdict === null) return false
      return new Promise<boolean>((resolve) => {
        set((s) => ({
          pending: {
            ...s.pending,
            [toolCallId]: {
              toolCallId,
              toolName,
              threadId,
              serverName,
              strict,
              extension: origin === 'extension',
              resolve,
            },
          },
        }))
      })
    },

    resolveApproval: (toolCallId, decision) => {
      const entry = get().pending[toolCallId]
      if (!entry) return
      set((s) => {
        const next = { ...s.pending }
        delete next[toolCallId]
        return { pending: next }
      })
      // Rust records the grant the answer gives and says whether the call
      // may run; a failed round-trip is a denial.
      consentAnswer(toolCallId, decision)
        .catch((error) => {
          console.error('Tool approval answer failed:', error)
          return false
        })
        .then(entry.resolve)
    },

    clearPendingForThread: (threadId) => {
      // Also ends authorizations given but not yet used, so a call approved
      // before Stop cannot run after it.
      void consentCancelThread(threadId).catch(() => {})
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
