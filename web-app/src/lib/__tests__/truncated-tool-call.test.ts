import { describe, expect, it } from 'vitest'
import { convertToModelMessages, generateText, type UIMessage } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  ChatCompletionRole,
  ContentType,
  MessageStatus,
  type ThreadMessage,
} from '@janhq/core'
import {
  coalesceMessagesForAlternation,
  fillMissingToolInputs,
  resolveOrphanToolCalls,
} from '../custom-chat-transport'
import { convertThreadMessageToUIMessage } from '../messages'

const userTurn = (id: string, text: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
})

// An assistant reply that hit the output-token limit while the model was
// still streaming a tool call's arguments, as it is stored in messages.jsonl:
// the tool_call part has no `input` and no `output`.
const truncatedReply: ThreadMessage = {
  id: 'a1',
  object: 'thread.message',
  thread_id: 't1',
  role: ChatCompletionRole.Assistant,
  status: MessageStatus.Ready,
  created_at: 0,
  completed_at: 0,
  content: [
    {
      type: ContentType.ToolCall,
      tool_call_id: 'call_00_abc',
      tool_name: 'my_tool',
    } as NonNullable<ThreadMessage['content']>[number],
  ],
  metadata: { finishReason: 'length', stopped: true },
}

/** The UI-to-model steps `CustomChatTransport.sendMessages` runs. */
const toModelMessages = (messages: UIMessage[]) =>
  convertToModelMessages(
    coalesceMessagesForAlternation(
      fillMissingToolInputs(resolveOrphanToolCalls(messages))
    )
  )

/** The JSON body an OpenAI-compatible provider (e.g. DeepSeek) is sent. */
async function requestBody(messages: UIMessage[]) {
  let body: { messages: Array<Record<string, unknown>> } | undefined
  const provider = createOpenAICompatible({
    name: 'deepseek',
    baseURL: 'https://api.example.test/v1',
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          id: 'r1',
          object: 'chat.completion',
          created: 0,
          model: 'm',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    },
  })
  await generateText({
    model: provider('m'),
    messages: await toModelMessages(messages),
  })
  return body!
}

describe('a thread with a tool call cut off by the token limit', () => {
  const history = () => [
    userTurn('u1', 'run my_tool'),
    convertThreadMessageToUIMessage(truncatedReply),
    userTurn('u2', 'try again'),
  ]

  it('sends the cut-off call with arguments', async () => {
    const body = await requestBody(history())
    const toolCalls = body.messages.flatMap(
      (m) =>
        (m.tool_calls as Array<{ function: { arguments?: unknown } }>) ?? []
    )
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].function.arguments).toBe('{}')
  })

  it('still answers the cut-off call with a tool result', async () => {
    const body = await requestBody(history())
    expect(body.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
    ])
    expect(body.messages[2].tool_call_id).toBe('call_00_abc')
  })
})

describe('fillMissingToolInputs', () => {
  const assistant = (parts: unknown[]): UIMessage =>
    ({ id: 'a1', role: 'assistant', parts }) as UIMessage

  it('gives tool parts with no input an empty object', () => {
    const out = fillMissingToolInputs([
      assistant([
        {
          type: 'tool-my_tool',
          toolCallId: 'c1',
          state: 'output-error',
          errorText: 'Tool call did not complete',
        },
        {
          type: 'tool-my_tool',
          toolCallId: 'c2',
          state: 'output-error',
          input: undefined,
          rawInput: '{"path": "C:\\',
          errorText: 'Invalid input',
        },
      ]),
    ])
    expect(out[0].parts.map((p) => (p as { input?: unknown }).input)).toEqual([
      {},
      {},
    ])
  })

  it('returns messages without missing inputs unchanged', () => {
    const messages = [
      userTurn('u1', 'hi'),
      assistant([
        { type: 'text', text: 'calling' },
        {
          type: 'tool-my_tool',
          toolCallId: 'c1',
          state: 'output-available',
          input: { q: 1 },
          output: 'ok',
        },
      ]),
    ]
    const out = fillMissingToolInputs(messages)
    expect(out[0]).toBe(messages[0])
    expect(out[1]).toBe(messages[1])
  })
})
