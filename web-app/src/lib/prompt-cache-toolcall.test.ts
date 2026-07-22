import { describe, it, expect } from 'vitest'
import { convertToModelMessages, type UIMessage } from 'ai'
import {
  coalesceMessagesForAlternation,
  resolveOrphanToolCalls,
  splitAssistantToolWaves,
} from './custom-chat-transport'

/**
 * Cache validation: llama.cpp reuses the KV cache only when the new prompt's
 * prefix is byte-identical to the previous one. When a turn involves a
 * (MCP) tool call, the assistant tool-call turn and its tool result must
 * survive into the NEXT turn's prompt unchanged, so the prefix up to that
 * point stays stable and the cache is reused.
 */

const pipeline = async (messages: UIMessage[]) =>
  convertToModelMessages(
    coalesceMessagesForAlternation(
      resolveOrphanToolCalls(splitAssistantToolWaves(messages))
    )
  )

describe('prompt cache stability across a tool-call turn', () => {
  const toolTurn: UIMessage = {
    id: 'a1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-mcp__fs__list',
        toolCallId: 'call_1',
        input: { path: '/tmp' },
        state: 'output-available',
        output: { files: ['a', 'b'] },
      },
      { type: 'text', text: 'There are two files.' },
    ],
  } as unknown as UIMessage

  const user1: UIMessage = {
    id: 'u1',
    role: 'user',
    parts: [{ type: 'text', text: 'What files are in /tmp?' }],
  } as UIMessage

  const user2: UIMessage = {
    id: 'u2',
    role: 'user',
    parts: [{ type: 'text', text: 'thanks' }],
  } as UIMessage

  it('keeps the cached tool-call prefix identical on the next turn', async () => {
    // A tool-call turn is two requests. The FIRST follow-up request (which
    // seeds the KV cache after the tool ran) carries the assistant tool-call
    // with no assistant text yet, followed by the tool result:
    const toolCallOnly: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-mcp__fs__list',
          toolCallId: 'call_1',
          input: { path: '/tmp' },
          state: 'output-available',
          output: { files: ['a', 'b'] },
        },
      ],
    } as unknown as UIMessage
    const cachedPrompt = await pipeline([user1, toolCallOnly])

    // On the NEXT user turn the final assistant text has been folded into the
    // same message as the tool call.
    const nextPrompt = await pipeline([user1, toolTurn, user2])

    // For the KV cache to be reused, the prefix up to the tool result must be
    // byte-identical to what was cached.
    const prefix = nextPrompt.slice(0, cachedPrompt.length)
    expect(prefix).toEqual(cachedPrompt)
  })

  it('preserves the MCP tool_call and its result in the next prompt', async () => {
    const prompt = await pipeline([user1, toolTurn, user2])
    const serialized = JSON.stringify(prompt)

    expect(serialized).toContain('call_1')
    expect(serialized).toContain('mcp__fs__list')
    // The tool result must still be present (tool_use paired with tool_result).
    const hasToolResult = prompt.some(
      (m) =>
        m.role === 'tool' &&
        Array.isArray(m.content) &&
        m.content.some(
          (c) => (c as { toolCallId?: string }).toolCallId === 'call_1'
        )
    )
    expect(hasToolResult).toBe(true)
  })

  it('renders the tool result before the follow-up assistant text', async () => {
    const prompt = await pipeline([user1, toolTurn, user2])
    const roles = prompt.map((m) => m.role)

    const toolCallIdx = prompt.findIndex(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some((c) => (c as { type?: string }).type === 'tool-call')
    )
    const toolResultIdx = roles.indexOf('tool')
    const textIdx = prompt.findIndex(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some(
          (c) => (c as { type?: string; text?: string }).text === 'There are two files.'
        )
    )

    expect(toolCallIdx).toBeGreaterThanOrEqual(0)
    expect(toolResultIdx).toBeGreaterThan(toolCallIdx)
    expect(textIdx).toBeGreaterThan(toolResultIdx)
  })
})

/**
 * The previous assistant turn (and the whole prefix before the new user
 * message) must be re-serialized byte-for-byte when the next user turn is
 * appended, otherwise llama.cpp reprocesses the prior turn instead of reusing
 * the KV cache. This covers plain text, reasoning (which preserve-reasoning
 * models resend so the server can re-emit prior <think>), and tool-call turns.
 */
describe('previous assistant turn is byte-identical in the next user turn', () => {
  const user1: UIMessage = {
    id: 'u1',
    role: 'user',
    parts: [{ type: 'text', text: 'question' }],
  } as UIMessage
  const user2: UIMessage = {
    id: 'u2',
    role: 'user',
    parts: [{ type: 'text', text: 'follow-up' }],
  } as UIMessage

  const cases: Array<{ name: string; assistant: UIMessage }> = [
    {
      name: 'plain text',
      assistant: {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'The answer is 42.' }],
      } as UIMessage,
    },
    {
      name: 'reasoning + text (preserve-reasoning)',
      assistant: {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'let me think about it' },
          { type: 'text', text: 'The answer is 42.' },
        ],
      } as unknown as UIMessage,
    },
    {
      name: 'tool-call + text',
      assistant: {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-mcp__fs__list',
            toolCallId: 'call_1',
            input: { path: '/tmp' },
            state: 'output-available',
            output: { files: ['a', 'b'] },
          },
          { type: 'text', text: 'Two files.' },
        ],
      } as unknown as UIMessage,
    },
  ]

  for (const { name, assistant } of cases) {
    it(`keeps the ${name} assistant turn byte-identical`, async () => {
      const before = await pipeline([user1, assistant])
      const after = await pipeline([user1, assistant, user2])

      expect(after.length).toBe(before.length + 1)
      expect(JSON.stringify(after.slice(0, before.length))).toBe(
        JSON.stringify(before)
      )
    })
  }

  it('resends the reasoning content (not dropped) for preserve-reasoning models', async () => {
    const assistant = cases[1].assistant
    const prompt = await pipeline([user1, assistant, user2])
    const hasReasoning = prompt.some(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some(
          (c) =>
            (c as { type?: string }).type === 'reasoning' &&
            (c as { text?: string }).text === 'let me think about it'
        )
    )
    expect(hasReasoning).toBe(true)
  })
})
