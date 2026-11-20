import { describe, it, expect } from 'vitest'
import { ContentType, MessageStatus } from '@janhq/core'
import type { ThreadMessage } from '@janhq/core'
import type { CoworkSession } from '@/hooks/useCoworkSessions'
import { convertThreadMessageToUIMessage } from '@/lib/messages'
import { STOPPED_TOOL_ERROR } from '@/lib/stopped-tool-calls'
import { coworkSessionToThreadMessages } from '../coworkThreadMessages'
import { SYSTEM_NOTICE_KEY, isSystemNotice } from '../coworkPing'

const UPDATED_MS = 1_700_000_000_000

type Part = Record<string, unknown>
const msg = (id: string, role: string, parts: Part[]) => ({ id, role, parts })

const session = (
  messages: unknown[],
  extra: Partial<CoworkSession> = {}
): CoworkSession =>
  ({
    id: 'sess-1',
    title: 'T',
    folder: null,
    turns: [{ role: 'user', content: 'x' }],
    messages,
    updated: UPDATED_MS,
    ...extra,
  }) as unknown as CoworkSession

const toolPart = (name: string, id: string, extra: Part = {}): Part => ({
  type: `tool-${name}`,
  toolCallId: id,
  input: { path: 'a.txt' },
  ...extra,
})

// A representative conversation: text, reasoning, a finished call, a failed
// call, an unfinished call and an image.
const conversation = () =>
  session([
    msg('u-1', 'user', [
      { type: 'text', text: 'read a.txt' },
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' },
    ]),
    msg('a-1', 'assistant', [
      { type: 'reasoning', text: 'I should read it' },
      { type: 'text', text: 'Reading.' },
      toolPart('read', 'call-ok', { state: 'output-available', output: 'hello' }),
      toolPart('read', 'call-bad', {
        state: 'output-error',
        errorText: 'ENOENT',
      }),
      toolPart('shell', 'call-hung', { state: 'input-available' }),
    ]),
    msg('u-2', 'user', [{ type: 'text', text: 'thanks' }]),
  ])

const toolContents = (m: ThreadMessage) =>
  m.content.filter((c) => c.type === ContentType.ToolCall)

describe('coworkSessionToThreadMessages', () => {
  it('derives ids from the session id and index, never from the clock', () => {
    const out = coworkSessionToThreadMessages(conversation())
    expect(out.map((m) => m.id)).toEqual([
      'sess-1-msg-0',
      'sess-1-msg-1',
      'sess-1-msg-2',
    ])
    expect(out.every((m) => m.thread_id === 'sess-1')).toBe(true)
  })

  it('stamps timestamps from the session, ending at its last update', () => {
    const out = coworkSessionToThreadMessages(conversation())
    expect(out.map((m) => m.created_at)).toEqual([
      UPDATED_MS - 2,
      UPDATED_MS - 1,
      UPDATED_MS,
    ])
    expect(out.every((m) => m.completed_at === m.created_at)).toBe(true)
  })

  it('accepts a session updated in seconds', () => {
    const out = coworkSessionToThreadMessages(
      session(conversation().messages, { updated: 1_700_000_000 })
    )
    expect(out.at(-1)?.created_at).toBe(UPDATED_MS)
  })

  it('is a pure function of the session: same input, same deep value and bytes', () => {
    const s = conversation()
    const before = JSON.stringify(s)
    const a = coworkSessionToThreadMessages(s)
    const b = coworkSessionToThreadMessages(JSON.parse(before))
    expect(b).toEqual(a)
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
    // The session is not mutated by converting it.
    expect(JSON.stringify(s)).toBe(before)
  })

  it('writes the shape main chat persists for each part', () => {
    const [user, assistant] = coworkSessionToThreadMessages(conversation())
    expect(user).toMatchObject({
      object: 'thread.message',
      type: 'text',
      role: 'user',
      status: MessageStatus.Ready,
    })
    expect(user.content).toEqual([
      { type: 'text', text: { value: 'read a.txt', annotations: [] } },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,AAAA', detail: 'auto' },
      },
    ])
    // Reasoning is its own content item, not <think> inside the text.
    expect(assistant.content.slice(0, 2)).toEqual([
      {
        type: 'reasoning',
        text: { value: 'I should read it', annotations: [] },
      },
      { type: 'text', text: { value: 'Reading.', annotations: [] } },
    ])
    expect(JSON.stringify(assistant.content)).not.toContain('<think>')
  })

  it('keeps tool call ids and pairs every call with a result or an error', () => {
    const assistant = coworkSessionToThreadMessages(conversation())[1]
    const calls = toolContents(assistant)
    expect(calls.map((c) => c.tool_call_id)).toEqual([
      'call-ok',
      'call-bad',
      'call-hung',
    ])
    expect(calls[0]).toMatchObject({ tool_name: 'read', output: 'hello' })
    expect(assistant.metadata).toEqual({
      toolErrors: { 'call-bad': 'ENOENT', 'call-hung': STOPPED_TOOL_ERROR },
    })

    // Through main's loader: no call is left "running".
    const ui = convertThreadMessageToUIMessage(assistant)
    const tools = ui.parts.filter((p) => p.type.startsWith('tool-')) as Array<{
      state: string
      toolCallId: string
    }>
    expect(tools.map((t) => [t.toolCallId, t.state])).toEqual([
      ['call-ok', 'output-available'],
      ['call-bad', 'output-error'],
      ['call-hung', 'output-error'],
    ])
  })

  it('keeps an empty tool output as a result, not as a call still running', () => {
    const [m] = coworkSessionToThreadMessages(
      session([
        msg('a', 'assistant', [
          toolPart('shell', 'c1', { state: 'output-available', output: '' }),
        ]),
      ])
    )
    const part = convertThreadMessageToUIMessage(m).parts[0] as {
      state: string
    }
    expect(part.state).toBe('output-available')
  })

  it('gives an error with no text a non-empty one so it reloads as an error', () => {
    const [m] = coworkSessionToThreadMessages(
      session([
        msg('a', 'assistant', [
          toolPart('shell', 'c1', { state: 'output-error', errorText: '' }),
        ]),
      ])
    )
    const part = convertThreadMessageToUIMessage(m).parts[0] as {
      state: string
    }
    expect(part.state).toBe('output-error')
  })

  it('mints deterministic ids for calls without one and for repeated ones', () => {
    const s = session([
      msg('a', 'assistant', [
        { type: 'tool-read', input: {}, state: 'output-available', output: 'x' },
        toolPart('read', 'dup', { state: 'output-available', output: 'y' }),
        toolPart('read', 'dup', { state: 'output-available', output: 'z' }),
      ]),
    ])
    const ids = (out: ThreadMessage[]) =>
      toolContents(out[0]).map((c) => c.tool_call_id)
    const first = ids(coworkSessionToThreadMessages(s))
    expect(first).toEqual(['sess-1-call-0-0', 'dup', 'sess-1-call-0-2'])
    expect(ids(coworkSessionToThreadMessages(s))).toEqual(first)
  })

  it('drops messages that carry nothing and still numbers by source index', () => {
    const out = coworkSessionToThreadMessages(
      session([
        msg('u', 'user', [{ type: 'text', text: 'hi' }]),
        msg('a', 'assistant', [{ type: 'text', text: '' }]),
        msg('u2', 'user', [{ type: 'text', text: 'again' }]),
      ])
    )
    expect(out.map((m) => m.id)).toEqual(['sess-1-msg-0', 'sess-1-msg-2'])
  })

  it('rebuilds from turns when a session has no messages', () => {
    const out = coworkSessionToThreadMessages(
      session([], {
        turns: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      })
    )
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('does not add trimming or whitespace changes of its own', () => {
    const [m] = coworkSessionToThreadMessages(
      session([msg('u', 'user', [{ type: 'text', text: '  keep \n' }])])
    )
    expect(m.content[0].text?.value).toBe('  keep \n')
  })

  it('reloads to the same UI messages every time', () => {
    const out = coworkSessionToThreadMessages(conversation())
    const once = out.map(convertThreadMessageToUIMessage)
    const twice = coworkSessionToThreadMessages(conversation()).map(
      convertThreadMessageToUIMessage
    )
    expect(twice).toEqual(once)
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
    // And a record that went through the file (JSON) loads the same.
    const viaFile = JSON.parse(JSON.stringify(out)).map(
      convertThreadMessageToUIMessage
    )
    expect(viaFile).toEqual(once)
  })

  it('treats a session without `updated` as 0, never NaN', () => {
    const s = session([msg('u', 'user', [{ type: 'text', text: 'hi' }])])
    delete (s as Partial<CoworkSession>).updated
    const out = coworkSessionToThreadMessages(s)
    expect(out[0].created_at).toBe(0)
    expect(JSON.stringify(out)).not.toContain('null')
  })

  it('lets the converter own toolErrors: stale source errors do not survive', () => {
    const s = session([
      {
        id: 'a',
        role: 'assistant',
        metadata: { toolErrors: { stale: 'old failure' }, keep: 1 },
        parts: [
          toolPart('read', 'ok', { state: 'output-available', output: 'x' }),
        ],
      },
      {
        id: 'b',
        role: 'assistant',
        metadata: { toolErrors: { stale: 'old failure' } },
        parts: [toolPart('read', 'bad', { state: 'output-error', errorText: 'E' })],
      },
    ])
    const [first, second] = coworkSessionToThreadMessages(s)
    expect(first.metadata).toEqual({ keep: 1 })
    expect(second.metadata).toEqual({ toolErrors: { bad: 'E' } })
  })

  it('reads reasoning as `reasoning ?? text`, like extractContentPartsFromUIMessage', () => {
    const s = session([
      msg('a', 'assistant', [
        { type: 'reasoning', reasoning: 'from reasoning', text: 'from text' },
        { type: 'reasoning', text: 'only text' },
      ]),
    ])
    const [m] = coworkSessionToThreadMessages(s)
    expect(m.content.map((c) => c.text?.value)).toEqual([
      'from reasoning',
      'only text',
    ])
  })

  describe('<SYSTEM> pings', () => {
    const PING = '<SYSTEM>\nSubagent researcher (c1) finished.\n</SYSTEM>'
    const withPing = () =>
      session([
        msg('u-1', 'user', [{ type: 'text', text: 'research it' }]),
        msg('a-1', 'assistant', [{ type: 'text', text: 'Started.' }]),
        msg('ping-2', 'user', [{ type: 'text', text: PING }]),
        msg('a-2', 'assistant', [{ type: 'text', text: 'It finished.' }]),
      ])

    it('keeps the ping in the history, as a user message with its text byte-identical', () => {
      const out = coworkSessionToThreadMessages(withPing())
      expect(out).toHaveLength(4)
      const ping = out[2]
      // Still what the model saw: a user turn carrying the exact same text, so
      // the replayed prompt prefix is unchanged.
      expect(ping.role).toBe('user')
      expect(ping.content).toEqual([
        { type: ContentType.Text, text: { value: PING, annotations: [] } },
      ])
    })

    it('flags the ping as a system notice and nothing else', () => {
      const out = coworkSessionToThreadMessages(withPing())
      expect(out[2].metadata).toEqual({ [SYSTEM_NOTICE_KEY]: true })
      for (const i of [0, 1, 3]) {
        expect(out[i].metadata?.[SYSTEM_NOTICE_KEY]).toBeUndefined()
      }
    })

    it('is deterministic: the same session gives the same bytes', () => {
      const a = JSON.stringify(coworkSessionToThreadMessages(withPing()))
      const b = JSON.stringify(coworkSessionToThreadMessages(withPing()))
      expect(a).toBe(b)
    })

    it('does not flag a message a user typed, even one that mentions the tag later', () => {
      const s = session([
        msg('u-1', 'user', [{ type: 'text', text: 'what does <SYSTEM> mean?' }]),
        msg('u-2', 'user', [
          { type: 'text', text: 'hi' },
          { type: 'text', text: PING },
        ]),
      ])
      const out = coworkSessionToThreadMessages(s)
      expect(out.map((m) => isSystemNotice(m))).toEqual([false, false])
    })

    it('survives the reload main chat does: the UI message still carries the flag', () => {
      const [, , ping] = coworkSessionToThreadMessages(withPing())
      const ui = convertThreadMessageToUIMessage(ping)
      expect(ui.role).toBe('user')
      expect(isSystemNotice(ui)).toBe(true)
      expect(ui.parts).toEqual([{ type: 'text', text: PING }])
    })
  })
})
