import { describe, it, expect } from 'vitest'
import {
  appendLiveMessages,
  coworkTurnsToUIMessages,
  userTurn,
} from '@/lib/coworkTurns'
import type { CoworkTurn } from '@/hooks/useCoworkSessions'

/* eslint-disable @typescript-eslint/no-explicit-any */
const partsOf = (messages: any[], index = 0) => messages[index]?.parts ?? []
const toolPart = (turns: CoworkTurn[]) =>
  partsOf(coworkTurnsToUIMessages(turns)).find((p: any) =>
    p.type?.startsWith('tool-')
  )

describe('coworkTurnsToUIMessages', () => {
  it('renders native reasoning as a reasoning part ahead of the answer', () => {
    const messages = coworkTurnsToUIMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'answer', reasoning: 'weigh options' },
    ])
    const parts = partsOf(messages, 1)
    expect(parts[0]).toEqual({ type: 'reasoning', text: 'weigh options' })
    expect(parts[1]).toEqual({ type: 'text', text: 'answer' })
  })

  it('a reasoning-only turn still renders (thought, then straight to a tool)', () => {
    const messages = coworkTurnsToUIMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', reasoning: 'thinking' },
    ])
    expect(partsOf(messages, 1)).toEqual([
      { type: 'reasoning', text: 'thinking' },
    ])
  })

  it('starts a new user message and flushes the assistant before it', () => {
    const messages = coworkTurnsToUIMessages([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'second' },
    ])
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('maps a tool turn onto a tool-<name> part carrying its input', () => {
    const part = toolPart([
      {
        role: 'tool',
        content: '',
        callId: 'call-1',
        name: 'edit',
        args: { path: 'a.ts' },
        result: 'ok',
        status: 'done',
      },
    ])
    expect(part.type).toBe('tool-edit')
    expect(part.toolCallId).toBe('call-1')
    expect(part.input).toEqual({ path: 'a.ts' })
    expect(part.state).toBe('output-available')
    expect(part.output).toBe('ok')
  })

  it('leaves a running tool call awaiting output', () => {
    const part = toolPart([
      {
        role: 'tool',
        content: '',
        callId: 'c',
        name: 'bash',
        status: 'running',
      },
    ])
    expect(part.state).toBe('input-available')
    expect(part.output).toBeUndefined()
    expect(part.errorText).toBeUndefined()
  })

  it('routes a failed tool call to errorText, not output', () => {
    const part = toolPart([
      {
        role: 'tool',
        content: '',
        callId: 'c',
        name: 'bash',
        result: 'boom',
        isError: true,
        status: 'done',
      },
    ])
    expect(part.state).toBe('output-error')
    expect(part.errorText).toBe('boom')
    expect(part.output).toBeUndefined()
  })

  // The diff used to be prepended to the output text, which both showed the
  // model a diff it authored and corrupted the output AgentToolWidget parses.
  // It now travels via useToolCallRuntime.diffs instead.
  it('keeps the diff out of the tool output entirely', () => {
    const diff = '@@ edit 1/1 @@\n-old\n+new'
    const part = toolPart([
      {
        role: 'tool',
        content: '',
        callId: 'c',
        name: 'edit',
        result: 'wrote a.ts',
        diff,
        status: 'done',
      },
    ])
    expect(part.output).toBe('wrote a.ts')
    expect(JSON.stringify(part)).not.toContain('+new')
  })

  it('falls back to legacy content when a turn has no result', () => {
    const part = toolPart([
      { role: 'tool', content: 'legacy body', callId: 'c', name: 'read' },
    ])
    expect(part.output).toBe('legacy body')
  })

  /// A write's body is the work, so the card reads it out of the raw argument
  /// fragment rather than holding empty until the closing brace lands.
  it('reads a running call out of its still-streaming arguments', () => {
    const part = toolPart([
      {
        role: 'tool',
        content: '',
        callId: 'c',
        name: 'write',
        status: 'running',
        argsLive: '{"path":"game.html","content":"<!doctype html>\\n<htm',
      },
    ])
    expect(part.state).toBe('input-streaming')
    expect(part.input).toEqual({
      path: 'game.html',
      content: '<!doctype html>\n<htm',
    })
  })

  /// Once the call is complete its parsed arguments are authoritative: the
  /// fragment they were read from is a prefix of them.
  it('prefers the settled arguments over the fragment', () => {
    const part = toolPart([
      {
        role: 'tool',
        content: '',
        callId: 'c',
        name: 'write',
        status: 'running',
        argsLive: '{"path":"game.htm',
        args: { path: 'game.html', content: 'done' },
      },
    ])
    expect(part.state).toBe('input-available')
    expect(part.input).toEqual({ path: 'game.html', content: 'done' })
  })

  /// A note the run folded in ends the assistant's message: what follows is a
  /// reply to it, not a continuation of what came before.
  it('gives a system note its own message, closing the assistant one', () => {
    const msgs = coworkTurnsToUIMessages([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'dispatched' },
      { role: 'system', content: "Subagent 'researcher' finished." },
      { role: 'assistant', content: 'here is what it found' },
    ])
    expect(msgs.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'system',
      'assistant',
    ])
    expect((msgs[2].parts[0] as { text: string }).text).toBe(
      "Subagent 'researcher' finished."
    )
  })

  it('keeps ids unique across prefixes so committed and live turns can merge', () => {
    const turns: CoworkTurn[] = [{ role: 'user', content: 'hi' }]
    const committed = coworkTurnsToUIMessages(turns, 'c')
    const live = coworkTurnsToUIMessages(turns, 'l')
    expect(committed[0].id).not.toBe(live[0].id)
  })

  describe('user attachments', () => {
    const png = { type: 'file' as const, mediaType: 'image/png', url: 'data:image/png;base64,AA' }
    const pdf = { name: 'spec.pdf', path: '/docs/spec.pdf', fileType: 'pdf', size: 1234 }

    it('userTurn keeps media and files beside the question', () => {
      expect(userTurn('read this', [png], [pdf])).toEqual({
        role: 'user',
        content: 'read this',
        media: [png],
        files: [pdf],
      })
    })

    it('userTurn omits empty attachment lists', () => {
      expect(userTurn('plain')).toEqual({ role: 'user', content: 'plain' })
      expect(userTurn('plain', [], [])).toEqual({ role: 'user', content: 'plain' })
    })

    it('renders attached media as file parts after the text', () => {
      const parts = partsOf(coworkTurnsToUIMessages([userTurn('look', [png])]))
      expect(parts).toEqual([{ type: 'text', text: 'look' }, png])
    })

    it('renders attached documents as the [ATTACHED_FILES] block MessageItem reads', () => {
      const parts = partsOf(coworkTurnsToUIMessages([userTurn('summarize', undefined, [pdf])]))
      expect(parts).toHaveLength(1)
      const text = parts[0].text as string
      expect(text.startsWith('summarize')).toBe(true)
      expect(text).toContain('[ATTACHED_FILES]')
      expect(text).toContain('name: spec.pdf')
      expect(text).toContain('type: pdf')
      expect(text).toContain('size: 1234')
    })

    it('leaves a turn with no attachments as a bare text part', () => {
      expect(partsOf(coworkTurnsToUIMessages([userTurn('hi')]))).toEqual([
        { type: 'text', text: 'hi' },
      ])
    })
  })
})

describe('appendLiveMessages', () => {
  const committed: CoworkTurn[] = [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: 'first' },
  ]

  it('an offset slice mints the ids the whole transcript would', () => {
    const live: CoworkTurn[] = [
      { role: 'user', content: 'again' },
      { role: 'assistant', content: 'second' },
    ]
    const whole = coworkTurnsToUIMessages([...committed, ...live], 's')
    const split = appendLiveMessages(
      coworkTurnsToUIMessages(committed, 's'),
      coworkTurnsToUIMessages(live, 's', committed.length)
    )
    expect(split).toEqual(whole)
    expect(split.map((m) => m.id)).toEqual([
      's-user-0',
      's-asst-1',
      's-user-2',
      's-asst-3',
    ])
  })

  it('keeps every committed message identical across a live update', () => {
    const base = coworkTurnsToUIMessages(committed, 's')
    const live: CoworkTurn[] = [
      { role: 'user', content: 'again' },
      {
        role: 'tool',
        content: '',
        callId: 'c1',
        name: 'write',
        status: 'running',
        argsLive: '{"path":"a.html","content":"<h1>',
      },
    ]
    const out = appendLiveMessages(
      base,
      coworkTurnsToUIMessages(live, 's', committed.length)
    )
    expect(out[0]).toBe(base[0])
    expect(out[1]).toBe(base[1])
    expect(out).toHaveLength(4)
  })

  it('joins a resumed run onto the committed assistant message', () => {
    const live: CoworkTurn[] = [{ role: 'assistant', content: 'continued' }]
    const whole = coworkTurnsToUIMessages([...committed, ...live], 's')
    const split = appendLiveMessages(
      coworkTurnsToUIMessages(committed, 's'),
      coworkTurnsToUIMessages(live, 's', committed.length)
    )
    expect(split).toEqual(whole)
    expect(split).toHaveLength(2)
    expect(partsOf(split, 1).map((p: any) => p.text)).toEqual([
      'first',
      'continued',
    ])
  })

  it('returns the committed list itself when nothing is live', () => {
    const base = coworkTurnsToUIMessages(committed, 's')
    expect(appendLiveMessages(base, [])).toBe(base)
  })
})
