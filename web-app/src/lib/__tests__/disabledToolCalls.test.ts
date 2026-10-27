import { describe, expect, it } from 'vitest'
import {
  jsonSchema,
  readUIMessageStream,
  streamText,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { routeRefusedToolCalls } from '../disabledToolCalls'

// #9319: the real SDK, not a mocked transport. A model calls `name` although
// only `web_search` was advertised, which is what happens to the shell once the
// user switches it off.
function modelCalling(name: string) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start' as const, warnings: [] },
          {
            type: 'tool-call' as const,
            toolCallId: 'call-1',
            toolName: name,
            input: '{"command":"echo hi"}',
          },
          {
            type: 'finish' as const,
            finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  })
}

async function lastMessage(
  stream: ReadableStream<UIMessageChunk>
): Promise<UIMessage | undefined> {
  let last: UIMessage | undefined
  for await (const m of readUIMessageStream({ stream })) last = m
  return last
}

function turn(name: string, isRefused: (toolName: string) => boolean) {
  const result = streamText({
    model: modelCalling(name),
    prompt: 'hi',
    tools: {
      web_search: {
        description: 'search',
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
      },
    },
  })
  return routeRefusedToolCalls(
    result.toUIMessageStream({ onError: (e) => String(e) }),
    isRefused
  )
}

describe('routeRefusedToolCalls', () => {
  it('turns the SDK rejection of a refused tool into a call the chat can answer', async () => {
    const message = await lastMessage(turn('shell', (n) => n === 'shell'))
    // The static `tool-shell` shape an advertised tool has, so the stored turn
    // and the follow-up request carry the call once.
    const part = message?.parts.find((p) => p.type === 'tool-shell')
    // `input-available` is what reaches onToolCall; `output-error` would mean
    // the SDK already settled the call and no follow-up request would be sent.
    expect(part).toMatchObject({
      type: 'tool-shell',
      toolCallId: 'call-1',
      state: 'input-available',
      input: { command: 'echo hi' },
    })
  })

  it('leaves the SDK error in place for a tool that is not refused', async () => {
    const message = await lastMessage(turn('shell', () => false))
    const part = message?.parts.find((p) => p.type === 'dynamic-tool')
    expect(part).toMatchObject({
      state: 'output-error',
      errorText: expect.stringContaining('unavailable tool'),
    })
  })

  it('does not touch an unadvertised tool that is not the refused one', async () => {
    const message = await lastMessage(turn('rm_rf', (n) => n === 'shell'))
    const part = message?.parts.find((p) => p.type === 'dynamic-tool')
    expect(part).toMatchObject({ toolName: 'rm_rf', state: 'output-error' })
  })
})
