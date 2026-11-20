import type { UIMessageChunk } from 'ai'

type ToolChunk = {
  type: string
  toolCallId?: string
  toolName?: string
  input?: unknown
}

/**
 * The AI SDK rejects a call to a tool that was not advertised: the stream
 * carries `tool-input-error` plus `tool-output-error` and the chat never learns
 * a call was made, so no tool loop runs and no follow-up request is sent. For
 * a tool Jan refuses on purpose (the shell switched off) that ends the turn
 * instead of telling the model "turned off" and letting it continue.
 *
 * This rewrites such a call into an ordinary `tool-input-available`, which
 * reaches `onToolCall`; the thread route then records its refusal as the
 * call's result and the follow-up request goes out. The SDK's own error result
 * is dropped so the call is not answered twice.
 */
export function routeRefusedToolCalls(
  stream: ReadableStream<UIMessageChunk>,
  isRefused: (toolName: string) => boolean
): ReadableStream<UIMessageChunk> {
  const rerouted = new Set<string>()
  return stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        const c = chunk as ToolChunk
        if (
          c.type === 'tool-input-error' &&
          c.toolCallId &&
          c.toolName &&
          isRefused(c.toolName)
        ) {
          rerouted.add(c.toolCallId)
          // Not `dynamic`: an advertised tool is stored as a static `tool-<name>`
          // part. Emitting a `dynamic-tool` part here was observed to put the
          // same call into the follow-up request twice, so the call is
          // emitted in the static shape.
          controller.enqueue({
            type: 'tool-input-available',
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            input: c.input,
          } as UIMessageChunk)
          return
        }
        if (
          c.type === 'tool-output-error' &&
          c.toolCallId &&
          rerouted.has(c.toolCallId)
        ) {
          return
        }
        controller.enqueue(chunk)
      },
    })
  )
}
