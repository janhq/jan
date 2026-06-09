import type { UIMessageChunk } from 'ai'
import type { CodexAppServerEvent } from './types'

export type CodexUIStreamOptions = {
  messageId?: string
  interrupt?: () => void | Promise<void>
}

type CodexMessageMetadata = {
  codex: {
    threadId?: string
    turnId?: string
    eventCount: number
    completed: boolean
  }
}

function decodeBase64Utf8(base64: string): string {
  try {
    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return new TextDecoder().decode(bytes)
  } catch (e) {
    return ''
  }
}

export function codexEventsToUIMessageStream(
  events: AsyncIterable<CodexAppServerEvent>,
  options: CodexUIStreamOptions = {}
): ReadableStream<UIMessageChunk> {
  const iterator = events[Symbol.asyncIterator]()
  const textPartIds = new Set<string>()
  const reasoningPartIds = new Set<string>()
  const reasoningPartsByItem = new Map<string, Set<string>>()
  
  // Accumulator maps for streaming delta events
  const commandOutputs = new Map<string, string>()
  const processOutputs = new Map<string, string>()
  const plans = new Map<string, string>()
  const fileChanges = new Map<string, string>()

  const metadata: CodexMessageMetadata = {
    codex: {
      eventCount: 0,
      completed: false,
    },
  }
  let finished = false

  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      controller.enqueue(
        options.messageId
          ? { type: 'start', messageId: options.messageId }
          : { type: 'start' }
      )

      try {
        while (true) {
          const { done, value } = await iterator.next()
          if (done) break

          metadata.codex.eventCount += 1
          applyMetadata(metadata, value)

          // 1. Map Assistant Deltas
          if (value.type === 'assistant_delta') {
            if (!textPartIds.has(value.itemId)) {
              textPartIds.add(value.itemId)
              controller.enqueue({ type: 'text-start', id: value.itemId })
            }
            controller.enqueue({
              type: 'text-delta',
              id: value.itemId,
              delta: value.delta,
            })
            continue
          }

          // 2. Map Reasoning Deltas to native AI SDK reasoning chunks
          if (value.type === 'reasoning_delta') {
            const reasoningPartId = getReasoningPartId(value.itemId, value)
            if (!reasoningPartIds.has(reasoningPartId)) {
              reasoningPartIds.add(reasoningPartId)
              const itemParts = reasoningPartsByItem.get(value.itemId) ?? new Set()
              itemParts.add(reasoningPartId)
              reasoningPartsByItem.set(value.itemId, itemParts)
              controller.enqueue({ type: 'reasoning-start', id: reasoningPartId })
            }
            controller.enqueue({
              type: 'reasoning-delta',
              id: reasoningPartId,
              delta: value.delta,
            })
            continue
          }

          if (value.type === 'reasoning_part_added') {
            const reasoningPartId = getReasoningPartId(value.itemId, value)
            if (!reasoningPartIds.has(reasoningPartId)) {
              reasoningPartIds.add(reasoningPartId)
              const itemParts = reasoningPartsByItem.get(value.itemId) ?? new Set()
              itemParts.add(reasoningPartId)
              reasoningPartsByItem.set(value.itemId, itemParts)
              controller.enqueue({ type: 'reasoning-start', id: reasoningPartId })
            }
            continue
          }

          // Close reasoning part when item completes
          if (
            value.type === 'item_completed' &&
            value.itemId &&
            reasoningPartsByItem.has(value.itemId)
          ) {
            const itemReasoningPartIds = reasoningPartsByItem.get(value.itemId) ?? new Set()
            itemReasoningPartIds.forEach((reasoningPartId) => {
              controller.enqueue({ type: 'reasoning-end', id: reasoningPartId })
              reasoningPartIds.delete(reasoningPartId)
            })
            reasoningPartsByItem.delete(value.itemId)
          }

          // 3. Handle Errors
          if (value.type === 'error') {
            controller.enqueue({ type: 'error', errorText: value.error.message })
            finish(controller, textPartIds, reasoningPartIds, metadata, 'error')
            return
          }

          // 4. Aggregate Delta-based Codex Events
          if (value.type === 'command_output_delta') {
            const accumulated = (commandOutputs.get(value.itemId) ?? '') + value.delta
            commandOutputs.set(value.itemId, accumulated)
            
            controller.enqueue({
              type: 'data-codex-event',
              id: `cmd-${value.itemId}`,
              data: {
                type: 'command_output',
                itemId: value.itemId,
                output: accumulated,
                threadId: value.threadId,
                turnId: value.turnId,
              },
            } as UIMessageChunk)
            continue
          }

          if (value.type === 'process_output_delta') {
            const decoded = decodeBase64Utf8(value.deltaBase64)
            const accumulated = (processOutputs.get(value.processHandle) ?? '') + decoded
            processOutputs.set(value.processHandle, accumulated)
            
            controller.enqueue({
              type: 'data-codex-event',
              id: `proc-${value.processHandle}`,
              data: {
                type: 'process_output',
                processHandle: value.processHandle,
                output: accumulated,
                stream: value.stream,
                capReached: value.capReached,
              },
            } as UIMessageChunk)
            continue
          }

          if (value.type === 'plan_delta') {
            const accumulated = (plans.get(value.itemId) ?? '') + value.delta
            plans.set(value.itemId, accumulated)
            
            controller.enqueue({
              type: 'data-codex-event',
              id: `plan-${value.itemId}`,
              data: {
                type: 'plan',
                itemId: value.itemId,
                plan: accumulated,
                threadId: value.threadId,
                turnId: value.turnId,
              },
            } as UIMessageChunk)
            continue
          }

          if (value.type === 'file_change_delta') {
            const accumulated = (fileChanges.get(value.itemId) ?? '') + value.delta
            fileChanges.set(value.itemId, accumulated)
            
            controller.enqueue({
              type: 'data-codex-event',
              id: `file-${value.itemId}`,
              data: {
                type: 'file_change',
                itemId: value.itemId,
                patch: accumulated,
                threadId: value.threadId,
                turnId: value.turnId,
              },
            } as UIMessageChunk)
            continue
          }

          // 5b. Special mapping for Codex runtime capability changes (skills/plugins/hooks)
          // These are part of the app-server capability layer surfaced live in the agent workspace.
          if (value.type === 'skills_changed') {
            controller.enqueue({
              type: 'data-codex-event',
              id: `skills-${value.threadId ?? 'global'}-${Date.now()}`,
              data: {
                type: 'warning',
                threadId: value.threadId,
                message: `Codex skills changed: ${formatCodexPayload(
                  (value as any).skills ?? (value as any).changed
                )}`,
                event: value,
              },
            } as UIMessageChunk)
            continue
          }
          if (value.type === 'plugins_changed') {
            controller.enqueue({
              type: 'data-codex-event',
              id: `plugins-${value.threadId ?? 'global'}-${Date.now()}`,
              data: {
                type: 'warning',
                threadId: value.threadId,
                message: `Codex plugins changed: ${formatCodexPayload(
                  (value as any).plugins ?? (value as any).changed
                )}`,
                event: value,
              },
            } as UIMessageChunk)
            continue
          }
          if (value.type === 'hooks_changed') {
            controller.enqueue({
              type: 'data-codex-event',
              id: `hooks-${value.threadId ?? 'global'}-${Date.now()}`,
              data: {
                type: 'warning',
                threadId: value.threadId,
                message: `Codex hooks changed: ${formatCodexPayload(
                  (value as any).hooks
                )}`,
                event: value,
              },
            } as UIMessageChunk)
            continue
          }

          if (value.type === 'turn_plan_updated') {
            controller.enqueue({
              type: 'data-codex-event',
              id: `plan-update-${value.turnId ?? value.threadId ?? Date.now()}`,
              data: {
                type: 'plan',
                threadId: value.threadId,
                turnId: value.turnId,
                plan: formatCodexPayload(value.plan ?? value.params),
              },
            } as UIMessageChunk)
            continue
          }

          if (value.type === 'turn_diff_updated') {
            controller.enqueue({
              type: 'data-codex-event',
              id: `diff-update-${value.turnId ?? value.threadId ?? Date.now()}`,
              data: {
                type: 'file_change_patch',
                threadId: value.threadId,
                turnId: value.turnId,
                patch: formatCodexPayload(value.diff ?? value.params),
              },
            } as UIMessageChunk)
            continue
          }

          if (
            value.type === 'model_rerouted' ||
            value.type === 'model_verification' ||
            value.type === 'turn_moderation_metadata' ||
            value.type === 'auto_approval_review_event' ||
            value.type === 'account_login_completed' ||
            value.type === 'account_updated' ||
            value.type === 'account_rate_limits_updated' ||
            value.type === 'mcp_oauth_login_completed' ||
            value.type === 'mcp_startup_status_updated' ||
            value.type === 'remote_control_status_changed' ||
            value.type === 'fs_changed' ||
            value.type === 'process_exited' ||
            value.type === 'thread_settings_updated' ||
            value.type === 'thread_archived' ||
            value.type === 'thread_unarchived' ||
            value.type === 'thread_name_updated' ||
            value.type === 'thread_closed' ||
            value.type === 'thread_goal_updated' ||
            value.type === 'thread_goal_cleared'
          ) {
            controller.enqueue({
              type: 'data-codex-event',
              id: getCodexEventChunkId(value),
              data: {
                type: 'warning',
                threadId: 'threadId' in value ? value.threadId : undefined,
                turnId: 'turnId' in value ? value.turnId : undefined,
                message: formatCodexStatusEvent(value),
                event: value,
              },
            } as UIMessageChunk)
            continue
          }

          // 5. Pass through other Codex events with unique stable IDs where appropriate
          let chunkId: string | undefined = undefined
          if ('itemId' in value && value.itemId) {
            chunkId = `evt-${value.type}-${value.itemId}`
          } else if ('processHandle' in value && value.processHandle) {
            chunkId = `evt-${value.type}-${value.processHandle}`
          } else if ('turnId' in value && value.turnId) {
            chunkId = `evt-${value.type}-${value.turnId}`
          }

          controller.enqueue({
            type: 'data-codex-event',
            id: chunkId,
            data: value,
          } as UIMessageChunk)
        }

        finish(controller, textPartIds, reasoningPartIds, metadata, 'stop')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        controller.enqueue({ type: 'error', errorText: message })
        finish(controller, textPartIds, reasoningPartIds, metadata, 'error')
      }
    },
    async cancel() {
      await options.interrupt?.()
    },
  })

  function finish(
    controller: ReadableStreamDefaultController<UIMessageChunk>,
    ids: Set<string>,
    reasoningIds: Set<string>,
    messageMetadata: CodexMessageMetadata,
    finishReason: 'stop' | 'error'
  ) {
    if (finished) return
    finished = true
    ids.forEach((id) => controller.enqueue({ type: 'text-end', id }))
    reasoningIds.forEach((id) => controller.enqueue({ type: 'reasoning-end', id }))
    controller.enqueue({
      type: 'finish',
      finishReason,
      messageMetadata,
    } as UIMessageChunk)
    controller.close()
  }
}

function getReasoningPartId(
  itemId: string,
  value: { summaryIndex?: number; contentIndex?: number }
) {
  if (value.summaryIndex !== undefined) {
    return `${itemId}:summary:${value.summaryIndex}`
  }

  if (value.contentIndex !== undefined) {
    return `${itemId}:content:${value.contentIndex}`
  }

  return itemId
}

function formatCodexPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

function getCodexEventChunkId(event: CodexAppServerEvent): string {
  const turnId =
    'turnId' in event && typeof event.turnId === 'string'
      ? event.turnId
      : undefined
  const threadId =
    'threadId' in event && typeof event.threadId === 'string'
      ? event.threadId
      : undefined
  return `${event.type}-${turnId ?? threadId ?? Date.now()}`
}

function formatCodexStatusEvent(event: CodexAppServerEvent): string {
  if (event.type === 'model_rerouted') {
    const from = event.fromModel ?? 'unknown'
    const to = event.toModel ?? 'unknown'
    const reason = event.reason ? `: ${formatCodexPayload(event.reason)}` : ''
    return `Model rerouted from ${from} to ${to}${reason}`
  }

  if (event.type === 'model_verification') {
    return `Model verification${event.status ? `: ${event.status}` : ''}`
  }

  if (event.type === 'turn_moderation_metadata') {
    return `Moderation metadata: ${formatCodexPayload(
      event.metadata ?? event.params
    )}`
  }

  if (event.type === 'auto_approval_review_event') {
    return `Auto-approval review event: ${event.method}`
  }

  if (event.type === 'account_login_completed') {
    return event.success
      ? 'Codex account login completed'
      : `Codex account login failed: ${formatCodexPayload(event.error)}`
  }

  if (event.type === 'account_updated') {
    return `Codex account updated: auth=${event.authMode ?? 'unknown'}, plan=${
      event.planType ?? 'unknown'
    }`
  }

  if (event.type === 'account_rate_limits_updated') {
    return `Codex account rate limits updated: ${formatCodexPayload(
      event.rateLimits
    )}`
  }

  if (event.type === 'mcp_oauth_login_completed') {
    return event.success
      ? `MCP OAuth login completed: ${event.name}`
      : `MCP OAuth login failed for ${event.name}: ${formatCodexPayload(
          event.error
        )}`
  }

  if (event.type === 'mcp_startup_status_updated') {
    return `MCP server ${event.name} status: ${event.status}${
      event.error ? ` (${formatCodexPayload(event.error)})` : ''
    }`
  }

  if (event.type === 'remote_control_status_changed') {
    return `Remote control status: ${event.status}${
      event.serverName ? ` (${event.serverName})` : ''
    }`
  }

  if (event.type === 'fs_changed') {
    return `Filesystem watch ${event.watchId} changed: ${event.changedPaths.join(
      ', '
    )}`
  }

  if (event.type === 'process_exited') {
    return `Process ${event.processHandle} exited with code ${event.exitCode}`
  }

  if (event.type === 'thread_settings_updated') {
    return `Thread ${event.threadId} settings updated: ${formatCodexPayload(
      event.threadSettings
    )}`
  }

  if (event.type === 'thread_archived') {
    return `Thread ${event.threadId} archived`
  }

  if (event.type === 'thread_unarchived') {
    return `Thread ${event.threadId} unarchived`
  }

  if (event.type === 'thread_name_updated') {
    return `Thread ${event.threadId} renamed to ${event.name ?? 'untitled'}`
  }

  if (event.type === 'thread_closed') {
    return `Thread ${event.threadId} closed`
  }

  if (event.type === 'thread_goal_updated') {
    return `Thread ${event.threadId} goal updated: ${formatCodexPayload(
      event.goal
    )}`
  }

  if (event.type === 'thread_goal_cleared') {
    return `Thread ${event.threadId} goal cleared`
  }

  return formatCodexPayload(event)
}

const applyMetadata = (
  metadata: CodexMessageMetadata,
  event: CodexAppServerEvent
) => {
  if ('threadId' in event) metadata.codex.threadId = event.threadId
  if ('turnId' in event) metadata.codex.turnId = event.turnId
  if (event.type === 'turn_completed') metadata.codex.completed = true
}
