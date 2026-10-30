import { create } from 'zustand'
import { useToolApproval } from './useToolApproval'
import { EXTENSION_SERVER_PREFIX } from '@/lib/extensions/tools'

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

/**
 * The name a grant is recorded under. A contributed tool is keyed by its
 * `ext:<id>` server as well, so a thread or global grant can never cover
 * a same-named tool of another extension or of an MCP server.
 */
const approvalKey = (toolName: string, serverName?: string) =>
  isExtensionServer(serverName) ? `${serverName}/${toolName}` : toolName

const isExtensionServer = (serverName?: string): serverName is string =>
  serverName?.startsWith(EXTENSION_SERVER_PREFIX) ?? false

export const useToolApprovalRequests = create<ToolApprovalRequestsState>()(
  (set, get) => ({
    pending: {},

    requestApproval: (toolCallId, toolName, threadId, serverName) => {
      return new Promise<boolean>((resolve) => {
        const settings = useToolApproval.getState()
        // The shortcut is for MCP; extension tools always go through approval.
        if (
          settings.allowAllMCPPermissions &&
          !isExtensionServer(serverName)
        ) {
          resolve(true)
          return
        }
        if (
          settings.isToolApproved(
            threadId,
            approvalKey(toolName, serverName),
            serverName
          )
        ) {
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
      const key = approvalKey(entry.toolName, entry.serverName)
      if (decision === 'allow-thread') {
        approval.approveToolForThread(entry.threadId, key)
      } else if (decision === 'allow-always') {
        // An MCP server is trusted whole. An extension is not: an update can
        // add tools, and those must ask before they first run.
        if (entry.serverName && !isExtensionServer(entry.serverName)) {
          approval.approveServer(entry.serverName)
        } else {
          approval.approveToolEverywhere(key)
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
