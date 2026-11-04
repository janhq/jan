import { create } from 'zustand'
import { useToolApproval } from './useToolApproval'
import { EXTENSION_SERVER_PREFIX } from '@/lib/extensions/tools'

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
   * and must not cover one that can send the extension's data anywhere.
   */
  strict?: boolean
  /**
   * Who serves the tool, as the caller resolved it. Only the caller can
   * know: an MCP server the user named `ext:<id>` can expose a tool with
   * the extension's exact wire name, so neither name tells them apart.
   * Absent means MCP, so nothing is ever let in as an extension's by
   * accident.
   */
  origin?: 'extension' | 'mcp'
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
    serverName?: string,
    options?: ApprovalOptions
  ) => Promise<boolean>
  resolveApproval: (toolCallId: string, decision: ApprovalDecision) => void
  clearPendingForThread: (threadId: string) => void
}

/**
 * The name a grant is recorded under. A tool with a server is keyed by it
 * as well, so a grant can never cover a same-named tool of another
 * extension or MCP server. Extension and MCP tools get separate namespaces
 * (`ext:` and `mcp:`) chosen by origin, so neither can spell the other's
 * key whatever the server or tool is called.
 */
const approvalKey = (
  toolName: string,
  serverName: string | undefined,
  extension: boolean
) => {
  if (!serverName) return toolName
  return extension
    ? `${serverName}/${toolName}`
    : `mcp:${serverName}/${toolName}`
}

export const useToolApprovalRequests = create<ToolApprovalRequestsState>()(
  (set, get) => ({
    pending: {},

    requestApproval: (toolCallId, toolName, threadId, serverName, options) => {
      const strict = options?.strict ?? false
      const extension = options?.origin === 'extension'
      return new Promise<boolean>((resolve) => {
        const settings = useToolApproval.getState()
        // The shortcut is for MCP; extension tools always go through approval.
        if (!strict && settings.allowAllMCPPermissions && !extension) {
          resolve(true)
          return
        }
        if (
          !strict &&
          settings.isToolApproved(
            threadId,
            approvalKey(toolName, serverName, extension),
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
              strict,
              extension,
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
      const key = approvalKey(
        entry.toolName,
        entry.serverName,
        entry.extension
      )
      if (entry.strict) {
        // Answers this call only; nothing is saved.
      } else if (decision === 'allow-thread') {
        approval.approveToolForThread(entry.threadId, key)
      } else if (decision === 'allow-always') {
        // An MCP server is trusted whole. An extension is not: an update can
        // add tools, and those must ask before they first run. An MCP server
        // the user named `ext:<id>` is not trusted whole either: that trust
        // would also cover the real extension <id>'s tools.
        if (
          entry.serverName &&
          !entry.serverName.startsWith(EXTENSION_SERVER_PREFIX) &&
          !entry.extension
        ) {
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
