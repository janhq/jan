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

export function codexEventsToUIMessageStream(
  events: AsyncIterable<CodexAppServerEvent>,
  options: CodexUIStreamOptions = {}
): ReadableStream<UIMessageChunk> {
  const iterator = events[Symbol.asyncIterator]()
  const textPartIds = new Set<string>()
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

          if (value.type === 'error') {
            controller.enqueue({ type: 'error', errorText: value.error.message })
            finish(controller, textPartIds, metadata, 'error')
            return
          }

          controller.enqueue({
            type: 'data-codex-event',
            data: value,
          } as UIMessageChunk)
        }

        finish(controller, textPartIds, metadata, 'stop')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        controller.enqueue({ type: 'error', errorText: message })
        finish(controller, textPartIds, metadata, 'error')
      }
    },
    async cancel() {
      await options.interrupt?.()
    },
  })

  function finish(
    controller: ReadableStreamDefaultController<UIMessageChunk>,
    ids: Set<string>,
    messageMetadata: CodexMessageMetadata,
    finishReason: 'stop' | 'error'
  ) {
    if (finished) return
    finished = true
    ids.forEach((id) => controller.enqueue({ type: 'text-end', id }))
    controller.enqueue({
      type: 'finish',
      finishReason,
      messageMetadata,
    } as UIMessageChunk)
    controller.close()
  }
}

const applyMetadata = (
  metadata: CodexMessageMetadata,
  event: CodexAppServerEvent
) => {
  if ('threadId' in event) metadata.codex.threadId = event.threadId
  if ('turnId' in event) metadata.codex.turnId = event.turnId
  if (event.type === 'turn_completed') metadata.codex.completed = true
}
