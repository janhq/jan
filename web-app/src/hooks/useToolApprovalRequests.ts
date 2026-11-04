import { create } from 'zustand'
import { useToolApproval } from './useToolApproval'
import { EXTENSION_SERVER_PREFIX } from '@/lib/extensions/tools'

/** Validation is not a user decision; this resolved result avoids unattended
 * early-prompt rejections while retaining the exact diagnostic for the loop. */
export type ApprovalValidationFailure = { kind: 'validation-error'; errorText: string }
export type ApprovalResult = boolean | ApprovalValidationFailure
export function throwIfApprovalValidationFailed(result: ApprovalResult): asserts result is boolean {
  if (typeof result !== 'boolean') throw new Error(result.errorText)
}

export type PendingApproval = {
  toolCallId: string
  toolName: string
  threadId: string
  /** MCP server the tool belongs to, so the prompt can offer to trust it. */
  serverName?: string
  resolve: (approved: ApprovalResult) => void
  /** Native (non-MCP) elevated call: approvals live in a native namespace
   * bound to the grant the call was classified under. */
  nativeKey?: string
}

/** Options for a native elevated request. Native approvals never inherit the
 * MCP-wide setting or a bare tool-name grant (an MCP tool may share the name);
 * allow-thread/allow-always persist only under `native:<tool>:<grantKey>`, so
 * they stop applying once the thread's grant changes. */
export type NativeApprovalOptions = { native: { grantKey: string } }

export const nativeApprovalKey = (toolName: string, grantKey: string): string =>
  `native:${toolName}:${grantKey}`

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

/** Collision-safe identity shared by visible prompts and validation in flight. */
export const approvalKey = (threadId: string, callId: string): string =>
  JSON.stringify([threadId, callId])

type ToolApprovalRequestsState = {
  // Only actionable prompts; validation and callbacks are never persisted.
  pending: Record<string, PendingApproval>

  requestApproval: (
    toolCallId: string,
    toolName: string,
    threadId: string,
    serverName?: string,
    validate?: ApprovalValidator,
    options?: NativeApprovalOptions
  ) => Promise<ApprovalResult>
  resolveApproval: (toolCallId: string, decision: ApprovalDecision, threadId: string) => void
  cancelApproval: (toolCallId: string, threadId: string) => void
  clearPendingForThread: (threadId: string) => void
}

/**
 * A contributed tool is keyed by its `ext:<id>` server as well, so a thread or
 * global grant can never cover a same-named tool of another extension, of an
 * MCP server, or a native tool. Extension grants live in the tool-name stores
 * (never `approvedServers`/`approvedMCPTools`), under this key only.
 */
export const isExtensionServer = (serverName?: string): serverName is string =>
  serverName?.startsWith(EXTENSION_SERVER_PREFIX) ?? false

export const extensionApprovalKey = (toolName: string, serverName: string): string =>
  `${serverName}/${toolName}`

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
      inFlight.get(approvalKey(entry.threadId, entry.toolCallId)) === entry
    const removePrompt = (entry: InFlightApproval) => {
      if (get().pending[approvalKey(entry.threadId, entry.toolCallId)] !== entry) return
      set((s) => {
        const next = { ...s.pending }
        delete next[approvalKey(entry.threadId, entry.toolCallId)]
        return { pending: next }
      })
    }
    const finish = (entry: InFlightApproval, approved: ApprovalResult) => {
      if (!isCurrent(entry)) return
      inFlight.delete(approvalKey(entry.threadId, entry.toolCallId))
      entry.controller.abort()
      removePrompt(entry)
      entry.resolve(approved)
    }

    return {
      pending: {},

      requestApproval: (toolCallId, toolName, threadId, serverName, validate, options) => {
        const nativeKey = !serverName && options?.native
          ? nativeApprovalKey(toolName, options.native.grantKey)
          : undefined
        const key = approvalKey(threadId, toolCallId)
        const previous = inFlight.get(key)
        if (previous) finish(previous, false)
        return new Promise<ApprovalResult>((resolve) => {
          const entry: InFlightApproval = {
            toolCallId, toolName, threadId, serverName, resolve, validate, nativeKey,
            deciding: false, controller: new AbortController(),
          }
          inFlight.set(key, entry)
          const publish = () => {
            if (!isCurrent(entry)) return
            const settings = useToolApproval.getState()
            // Native elevated calls ignore the MCP blanket and bare names: only
            // an earlier native choice under this same grant approves them.
            // Extension tools never use the MCP blanket or a trusted server:
            // only a grant recorded for this exact extension tool applies.
            const preApproved = nativeKey
              ? settings.isToolApproved(threadId, nativeKey)
              : isExtensionServer(serverName)
                ? settings.isToolApproved(threadId, extensionApprovalKey(toolName, serverName))
                : settings.allowAllMCPPermissions ||
                  settings.isToolApproved(threadId, toolName, serverName)
            if (preApproved) {
              finish(entry, true)
              return
            }
            set((s) => ({ pending: { ...s.pending, [key]: entry } }))
          }
          // Preserve synchronous prompting/auto-approval for existing callers.
          if (!validate) publish()
          else {
            void (async () => {
              try {
                await validate(entry.controller.signal)
                publish()
              } catch (error) {
                finish(entry, { kind: 'validation-error', errorText: error instanceof Error ? error.message : 'MCP identity validation failed' })
              }
            })()
          }
        })
      },

      resolveApproval: (toolCallId, decision, threadId) => {
        const key = approvalKey(threadId, toolCallId)
        const entry = inFlight.get(key)
        if (!entry) return
        // Denial wins even while an earlier allow decision is validating.
        if (decision === 'deny') {
          finish(entry, false)
          return
        }
        if (entry.deciding || get().pending[key] !== entry) return
        entry.deciding = true
        removePrompt(entry)
        const grant = () => {
          if (!isCurrent(entry)) return
          // Consume before persistence: synchronous store subscribers cannot
          // race another decision or resurrect this request.
          inFlight.delete(key)
          const approval = useToolApproval.getState()
          const extension = isExtensionServer(entry.serverName)
          const stored = entry.nativeKey
            ?? (extension ? extensionApprovalKey(entry.toolName, entry.serverName!) : entry.toolName)
          if (decision === 'allow-thread') {
            approval.approveToolForThread(entry.threadId, stored, extension ? undefined : entry.serverName)
          } else if (decision === 'allow-always') {
            // An MCP server is trusted whole. An extension is not: an update
            // can add tools, and those must ask before they first run.
            if (entry.serverName && !extension) approval.approveServer(entry.serverName)
            else approval.approveToolEverywhere(stored)
          }
          entry.resolve(true)
        }
        if (!entry.validate) grant()
        else {
          void (async () => {
            try {
              await entry.validate!(entry.controller.signal)
              grant()
            } catch (error) {
              finish(entry, { kind: 'validation-error', errorText: error instanceof Error ? error.message : 'MCP identity validation failed' })
            }
          })()
        }
      },

      cancelApproval: (toolCallId, threadId) => {
        const entry = inFlight.get(approvalKey(threadId, toolCallId))
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
