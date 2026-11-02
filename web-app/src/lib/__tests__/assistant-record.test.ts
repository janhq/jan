/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import type { ThreadMessage } from '@janhq/core'
import { convertToModelMessages } from 'ai'
import {
  assistantRecordFields,
  convertThreadMessageToUIMessage,
  extractContentPartsFromUIMessage,
  toolErrorsOf,
} from '@/lib/messages'
import {
  coalesceMessagesForAlternation,
  resolveOrphanToolCalls,
  splitAssistantToolWaves,
} from '@/lib/custom-chat-transport'
import { newUserThreadContent } from '@/lib/completion'

const assistant = (parts: any[], metadata?: Record<string, unknown>) =>
  ({ id: 'a1', role: 'assistant', parts, metadata }) as UIMessage

// What onFinish / rewriteStoredTurn built before assistantRecordFields.
const oldFields = (
  message: UIMessage,
  base: Record<string, unknown> | undefined,
  stopped = false
) => {
  const toolErrors = toolErrorsOf(message)
  return {
    content: extractContentPartsFromUIMessage(message),
    metadata: {
      ...(base || {}),
      ...(stopped ? { stopped: true } : {}),
      ...(toolErrors ? { toolErrors } : {}),
    },
  }
}

const toRecord = (
  id: string,
  fields: { content: any[]; metadata: Record<string, unknown> }
) =>
  ({
    id,
    object: 'thread.message',
    thread_id: 't1',
    role: 'assistant',
    status: 'ready',
    created_at: 1000,
    completed_at: 1000,
    content: fields.content,
    metadata: fields.metadata,
  }) as unknown as ThreadMessage

// Storage goes through serde_json::Value on the Rust side: undefined is
// dropped, and object keys come back sorted if `preserve_order` is ever off
// (the harsher case, so the tests use it).
const sortKeys = (v: any): any =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sortKeys(v[k])])
        )
      : v
const persist = (r: ThreadMessage): ThreadMessage =>
  sortKeys(JSON.parse(JSON.stringify(r)))

const build = (
  message: UIMessage,
  base?: Record<string, unknown>,
  stopped = false
) => toRecord(message.id, assistantRecordFields(message, base, { stopped }))

const reload = (message: UIMessage, base?: Record<string, unknown>) =>
  convertThreadMessageToUIMessage(persist(build(message, base))).parts

describe('assistantRecordFields: stored content and old metadata fields', () => {
  const cases: Record<string, [any[], Record<string, unknown> | undefined, boolean]> = {
    plain: [[{ type: 'text', text: 'hello', state: 'done' }], undefined, false],
    trailing: [[{ type: 'step-start' }, { type: 'text', text: 'hi \n' }], { a: 1 }, false],
    toolError: [
      [
        { type: 'tool-x', toolCallId: 'c1', state: 'output-error', input: { a: 1 }, errorText: 'boom' },
        { type: 'tool-y', toolCallId: 'c2', state: 'output-available', input: {}, output: 'ok' },
      ],
      { parentId: 'u1', toolErrors: { old: 'stale' } },
      false,
    ],
    stopped: [
      [{ type: 'tool-x', toolCallId: 'c3', state: 'input-streaming', input: { a: 1 } }],
      { createdAt: new Date(5) },
      true,
    ],
    media: [
      [
        { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' },
        { type: 'file', mediaType: 'audio/wav', url: 'data:audio/wav;base64,BBBB' },
      ],
      undefined,
      false,
    ],
  }
  for (const [name, [parts, base, stopped]] of Object.entries(cases)) {
    it(`matches the old inline builder: ${name}`, () => {
      const message = assistant(parts)
      const next = assistantRecordFields(message, base, { stopped })
      const old = oldFields(message, base, stopped)
      expect(next.content).toEqual(old.content)
      const rest = { ...next.metadata }
      delete rest.uiParts
      delete rest.uiPartsSkipped
      expect(rest).toEqual(old.metadata)
    })
  }
})

describe('assistantRecordFields: no uiParts when the reload is lossless', () => {
  it('plain text answer', () => {
    const { metadata } = assistantRecordFields(
      assistant([{ type: 'text', text: 'Hello there.', state: 'done' }]),
      undefined,
      {}
    )
    expect(metadata).toEqual({})
  })

  it('reasoning + text answer', () => {
    const { metadata } = assistantRecordFields(
      assistant([
        { type: 'reasoning', text: 'let me think', state: 'done' },
        { type: 'text', text: 'Answer.', state: 'done' },
      ]),
      undefined,
      {}
    )
    expect(metadata.uiParts).toBeUndefined()
  })

  it('static tool output-available / output-error', () => {
    const { metadata } = assistantRecordFields(
      assistant([
        { type: 'tool-ls', toolCallId: 'c1', state: 'output-available', input: { p: '.' }, output: 'a b' },
        { type: 'tool-rm', toolCallId: 'c2', state: 'output-error', input: { p: 'x' }, errorText: 'denied' },
      ]),
      undefined,
      {}
    )
    expect(metadata.uiParts).toBeUndefined()
    expect(metadata.toolErrors).toEqual({ c2: 'denied' })
  })
})

describe('lossless reload of each known loss', () => {
  const cases: Record<string, [any[], any[]]> = {
    'trimmed text': [
      [{ type: 'text', text: '  hi there \n', state: 'done' }],
      [{ type: 'text', text: '  hi there \n' }],
    ],
    'step-start': [
      [{ type: 'step-start' }, { type: 'text', text: 'hi' }],
      [{ type: 'step-start' }, { type: 'text', text: 'hi' }],
    ],
    'reasoning providerMetadata signature': [
      [
        { type: 'reasoning', text: 'think', state: 'done', providerMetadata: { anthropic: { signature: 'sig' } } },
        { type: 'text', text: 'ans', providerMetadata: { x: { y: 1 } } },
      ],
      [
        { type: 'reasoning', text: 'think', providerMetadata: { anthropic: { signature: 'sig' } } },
        { type: 'text', text: 'ans', providerMetadata: { x: { y: 1 } } },
      ],
    ],
    'tool callProviderMetadata': [
      [{ type: 'tool-shell', toolCallId: 'c1', state: 'output-available', input: { cmd: 'ls' }, output: 'a', callProviderMetadata: { p: { q: 1 } } }],
      [{ type: 'tool-shell', toolCallId: 'c1', state: 'output-available', input: { cmd: 'ls' }, output: 'a', callProviderMetadata: { p: { q: 1 } } }],
    ],
    "falsy output ''": [
      [{ type: 'tool-x', toolCallId: 'c2', state: 'output-available', input: {}, output: '' }],
      [{ type: 'tool-x', toolCallId: 'c2', state: 'output-available', input: {}, output: '' }],
    ],
    'falsy output 0': [
      [{ type: 'tool-x', toolCallId: 'c2', state: 'output-available', input: {}, output: 0 }],
      [{ type: 'tool-x', toolCallId: 'c2', state: 'output-available', input: {}, output: 0 }],
    ],
    'output-denied': [
      [{ type: 'tool-x', toolCallId: 'c6', state: 'output-denied', input: { a: 1 }, approval: { id: 'ap', approved: false, reason: 'no' } }],
      [{ type: 'tool-x', toolCallId: 'c6', state: 'output-denied', input: { a: 1 }, approval: { id: 'ap', approved: false, reason: 'no' } }],
    ],
    'dynamic-tool': [
      [{ type: 'dynamic-tool', toolName: 'mcp_x', toolCallId: 'c4', state: 'output-available', input: {}, output: { ok: 1 } }],
      [{ type: 'dynamic-tool', toolName: 'mcp_x', toolCallId: 'c4', state: 'output-available', input: {}, output: { ok: 1 } }],
    ],
    'png mediaType': [
      [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' }],
      [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' }],
    ],
    'pdf file': [
      [{ type: 'file', mediaType: 'application/pdf', url: 'data:application/pdf;base64,AAAA', filename: 'a.pdf' }],
      [{ type: 'file', mediaType: 'application/pdf', url: 'data:application/pdf;base64,AAAA', filename: 'a.pdf' }],
    ],
    'source-url and source-document': [
      [
        { type: 'source-url', sourceId: 's1', url: 'https://x', title: 'X', providerMetadata: { a: 1 } },
        { type: 'source-document', sourceId: 's2', mediaType: 'text/plain', title: 'Doc' },
        { type: 'text', text: 't' },
      ],
      [
        { type: 'source-url', sourceId: 's1', url: 'https://x', title: 'X' },
        { type: 'source-document', sourceId: 's2', mediaType: 'text/plain', title: 'Doc' },
        { type: 'text', text: 't' },
      ],
    ],
    'literal <think> text': [
      [{ type: 'text', text: 'literal <think>x</think> y' }],
      [{ type: 'text', text: 'literal <think>x</think> y' }],
    ],
  }
  for (const [name, [parts, expected]] of Object.entries(cases)) {
    it(name, () => {
      const message = assistant(parts)
      expect(build(message).metadata?.uiParts).toBeDefined()
      expect(reload(message)).toEqual(expected)
    })
  }
})

describe('media dedup', () => {
  const count = (hay: string, needle: string) => hay.split(needle).length - 1

  it('stores a png data URL once and reloads it', () => {
    const url = `data:image/png;base64,${'Q'.repeat(400)}`
    const message = assistant([
      { type: 'text', text: ' see ' },
      { type: 'file', mediaType: 'image/png', url },
    ])
    const record = build(message)
    expect(record.metadata?.uiParts).toBeDefined()
    expect(count(JSON.stringify(record), 'Q'.repeat(400))).toBe(1)
    expect(reload(message)).toEqual([
      { type: 'text', text: ' see ' },
      { type: 'file', mediaType: 'image/png', url },
    ])
  })

  it('stores an audio wav payload once and reloads it', () => {
    const url = `data:audio/wav;base64,${'W'.repeat(400)}`
    const message = assistant([
      { type: 'step-start' },
      { type: 'file', mediaType: 'audio/wav', url, filename: 'a.wav' },
    ])
    const record = build(message)
    expect(record.metadata?.uiParts).toBeDefined()
    expect(count(JSON.stringify(record), 'W'.repeat(400))).toBe(1)
    expect(reload(message)).toEqual([
      { type: 'step-start' },
      { type: 'file', mediaType: 'audio/wav', url, filename: 'a.wav' },
    ])
  })
})


// What the record reloads to with its carrier removed: today's path.
const legacyReload = (record: ThreadMessage) => {
  const metadata = { ...(record.metadata as any) }
  delete metadata.uiParts
  delete metadata.uiPartsSkipped
  return convertThreadMessageToUIMessage({ ...record, metadata }).parts
}

describe('corrupt carriers fall back to the content path', () => {
  const lossy = assistant([
    { type: 'step-start' },
    { type: 'text', text: 'hi \n' },
  ])
  const corrupt: Record<string, (u: any) => any> = {
    'v: 2': (u) => ({ ...u, v: 2 }),
    'parts not an array': (u) => ({ ...u, parts: { a: 1 } }),
    'bad contentRef': (u) => ({
      ...u,
      parts: [{ type: 'file', mediaType: 'image/png', contentRef: 99 }],
    }),
    'contentRef to a non-media entry': (u) => ({
      ...u,
      parts: [{ type: 'file', mediaType: 'image/png', contentRef: 0 }],
    }),
    'null part': (u) => ({ ...u, parts: [null] }),
    'unknown stored part': (u) => ({ ...u, parts: [...u.parts, { type: 'data-x' }] }),
    'empty parts': (u) => ({ ...u, parts: [] }),
    'uiParts not an object': () => 'nope',
  }
  for (const [name, mutate] of Object.entries(corrupt)) {
    it(name, () => {
      const record = persist(build(lossy)) as any
      record.metadata.uiParts = mutate(record.metadata.uiParts)
      let back: UIMessage | undefined
      expect(() => {
        back = convertThreadMessageToUIMessage(record)
      }).not.toThrow()
      expect(back!.parts).toEqual([{ type: 'text', text: 'hi' }])
      expect((back!.metadata as any).uiParts).toBeUndefined()
    })
  }
})

describe('no silent truncation', () => {
  it('a carrier over 256 KB is skipped as size', () => {
    const text = `${'a'.repeat(1024)} `
    const message = assistant([
      { type: 'text', text },
      { type: 'file', mediaType: 'application/pdf', url: `data:application/pdf;base64,${'P'.repeat(300 * 1024)}` },
    ])
    const record = build(message)
    expect(record.metadata?.uiParts).toBeUndefined()
    expect(record.metadata?.uiPartsSkipped).toBe('size')
    expect(record.content).toEqual(oldFields(message, undefined).content)
    expect(reload(message)).toEqual([{ type: 'text', text: text.trim() }])
  })

  it('a large tool result is stored once (in content) and reloads losslessly', () => {
    const output = 'r'.repeat(300 * 1024)
    const message = assistant([
      { type: 'step-start' },
      { type: 'tool-x', toolCallId: 'c1', state: 'output-available', input: {}, output },
    ])
    const record = build(message)
    expect(record.metadata?.uiPartsSkipped).toBeUndefined()
    expect((record.metadata?.uiParts as any).parts[1]).toMatchObject({ outputInContent: true })
    expect(JSON.stringify(record).split(output).length - 1).toBe(1)
    expect(reload(message)).toEqual(message.parts)
  })

  it('a falsy tool output content cannot hold stays inline', () => {
    const message = assistant([
      { type: 'step-start' },
      { type: 'tool-x', toolCallId: 'c1', state: 'output-available', input: {}, output: '' },
    ])
    const part = (build(message).metadata?.uiParts as any).parts[1]
    expect(part.output).toBe('')
    expect(part.outputInContent).toBeUndefined()
    expect(reload(message)).toEqual(message.parts)
  })

  it('a bad outputInContent pointer falls back to the content path', () => {
    const message = assistant([
      { type: 'step-start' },
      { type: 'tool-x', toolCallId: 'c1', state: 'output-available', input: {}, output: 'big' },
    ])
    const record = persist(build(message)) as any
    record.metadata.uiParts.parts[1].toolCallId = 'other'
    expect(convertThreadMessageToUIMessage(record).parts).toEqual(
      convertThreadMessageToUIMessage(
        persist(toRecord('a1', oldFields(message, undefined)))
      ).parts
    )
  })

  it('output-denied without an approval is never written or read', () => {
    const denied = { type: 'tool-x', toolCallId: 'c1', state: 'output-denied', input: {} }
    const message = assistant([{ type: 'step-start' }, denied])
    const record = build(message)
    expect(record.metadata?.uiParts).toBeUndefined()
    expect(record.metadata?.uiPartsSkipped).toBe('unsupported-part')
    const forged = persist(record) as any
    forged.metadata.uiParts = { v: 1, parts: [{ type: 'step-start' }, denied] }
    const back = convertThreadMessageToUIMessage(forged).parts as any[]
    expect(back.some((p) => p.state === 'output-denied')).toBe(false)
  })

  it('a signature over 8 KB is skipped as provider-metadata and reloads as today', () => {
    const message = assistant([
      { type: 'step-start' },
      { type: 'reasoning', text: 'r', providerMetadata: { anthropic: { signature: 'x'.repeat(9000) } } },
      { type: 'text', text: 'a ' },
    ])
    const record = build(message)
    expect(record.metadata?.uiParts).toBeUndefined()
    expect(record.metadata?.uiPartsSkipped).toBe('provider-metadata')
    expect(reload(message)).toEqual(legacyReload(persist(record)))
    expect(reload(message)).toEqual([
      { type: 'reasoning', text: 'r' },
      { type: 'text', text: 'a' },
    ])
  })

  it('an unknown part is skipped as unsupported-part', () => {
    const message = assistant([
      { type: 'text', text: 'a ' },
      { type: 'data-progress', data: { n: 1 } },
    ])
    const record = build(message)
    expect(record.metadata?.uiParts).toBeUndefined()
    expect(record.metadata?.uiPartsSkipped).toBe('unsupported-part')
    expect(reload(message)).toEqual([{ type: 'text', text: 'a' }])
  })

  it('a carrier the reader would reject is skipped as mismatch', () => {
    // In flight but already carrying an output: the sanitized part drops the
    // output while `content` keeps it, so the carrier could never validate.
    const message = assistant([
      { type: 'step-start' },
      { type: 'tool-x', toolCallId: 'c1', state: 'input-available', input: { a: 1 }, output: 'early' },
    ])
    const record = build(message)
    expect(record.metadata?.uiParts).toBeUndefined()
    expect(record.metadata?.uiPartsSkipped).toBe('mismatch')
    expect(reload(message)).toEqual(
      convertThreadMessageToUIMessage(
        persist(toRecord('a1', oldFields(message, undefined)))
      ).parts
    )
  })
})

describe('inherited carrier fields', () => {
  it('strips the base uiParts / uiPartsSkipped and recomputes them', () => {
    const stale = { uiParts: { v: 1, parts: [{ type: 'text', text: 'OLD' }] }, uiPartsSkipped: 'size' }
    const plain = assistantRecordFields(
      assistant([{ type: 'text', text: 'new' }]),
      { ...stale, parentId: 'u1' },
      {}
    )
    expect(plain.metadata).toEqual({ parentId: 'u1' })

    const lossy = assistantRecordFields(assistant([{ type: 'text', text: 'new ' }]), stale, {})
    expect(lossy.metadata).toEqual({
      uiParts: { v: 1, parts: [{ type: 'text', text: 'new ' }] },
    })
  })

  it('never returns uiParts in the reloaded UIMessage metadata', () => {
    const record = persist(build(assistant([{ type: 'text', text: 'x ' }])))
    const back = convertThreadMessageToUIMessage(record)
    expect(back.metadata).toEqual({ createdAt: new Date(1000) })
  })

  it('surfaces a skipped carrier: warns on write and keeps the reason on reload', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const record = persist(build(assistant([{ type: 'text', text: 'x ' }, { type: 'data-x' }])))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('a1'))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('unsupported-part'))
      // All or nothing: no partial carrier is kept beside the reason.
      expect(record.metadata).not.toHaveProperty('uiParts')
      const back = convertThreadMessageToUIMessage(record)
      expect(back.metadata).toEqual({
        uiPartsSkipped: 'unsupported-part',
        createdAt: new Date(1000),
      })
      // ...and a rebuild from that metadata recomputes it, never inherits it.
      const rebuilt = assistantRecordFields(back, back.metadata as any, {})
      expect(rebuilt.metadata).not.toHaveProperty('uiPartsSkipped')
    } finally {
      warn.mockRestore()
    }
  })
})

describe('stopped turns', () => {
  it('sets stopped and reloads a streaming tool as input-available', () => {
    const message = assistant([
      { type: 'step-start' },
      { type: 'text', text: 'running ' },
      { type: 'tool-x', toolCallId: 'c5', state: 'input-streaming', input: { a: 1 } },
    ])
    const record = build(message, undefined, true)
    expect(record.metadata?.stopped).toBe(true)
    expect(reload(message)).toEqual([
      { type: 'step-start' },
      { type: 'text', text: 'running ' },
      { type: 'tool-x', toolCallId: 'c5', state: 'input-available', input: { a: 1 } },
    ])
  })

  it('maps approval-requested and approval-responded to input-available without the approval', () => {
    const message = assistant([
      { type: 'step-start' },
      { type: 'tool-x', toolCallId: 'c7', state: 'approval-requested', input: {}, approval: { id: 'ap' } },
      { type: 'tool-y', toolCallId: 'c8', state: 'approval-responded', input: {}, approval: { id: 'ap2', approved: true } },
    ])
    expect(reload(message)).toEqual([
      { type: 'step-start' },
      { type: 'tool-x', toolCallId: 'c7', state: 'input-available', input: {} },
      { type: 'tool-y', toolCallId: 'c8', state: 'input-available', input: {} },
    ])
  })
})

describe('records not written by assistantRecordFields', () => {
  it('user messages reload as before', () => {
    const user = newUserThreadContent(
      't1',
      'look at this',
      [
        { name: 'a.txt', type: 'document', fileType: 'txt', id: 'd1' } as any,
        { name: 'p.png', type: 'image', base64: 'IMG', mimeType: 'image/png' } as any,
      ],
      'u1'
    )
    const back = convertThreadMessageToUIMessage(user)
    const text = (user.content[0] as any).text.value as string
    expect(text).toContain('[ATTACHED_FILES]')
    expect(back.parts).toEqual([
      { type: 'text', text },
      { type: 'file', mediaType: 'image/jpeg', url: 'data:image/png;base64,IMG' },
    ])
    expect(back.metadata).toEqual({
      ...(user.metadata || {}),
      createdAt: new Date(user.created_at),
    })
  })

  it('legacy metadata.tool_calls records reload as before', () => {
    const record = toRecord('a2', {
      content: [{ type: 'text', text: { value: 'done', annotations: [] } }],
      metadata: {
        tool_calls: [
          {
            tool: { id: 't1', function: { name: 'ls', arguments: '{"p":"."}' } },
            response: { content: [{ type: 'text', text: 'a b' }] },
          },
          { tool: { id: 't2', function: { name: 'rm', arguments: '{}' } } },
        ],
      },
    })
    expect(convertThreadMessageToUIMessage(record).parts).toEqual([
      { type: 'text', text: 'done' },
      { type: 'tool-ls', toolCallId: 't1', input: { p: '.' }, state: 'output-available', output: 'a b' },
      { type: 'tool-rm', toolCallId: 't2', input: {}, state: 'input-available' },
    ])
  })

  it('pre-change records with toolErrors and plain content reload as before', () => {
    const record = toRecord('a3', {
      content: [
        { type: 'reasoning', text: { value: 'r', annotations: [] } },
        { type: 'text', text: { value: ' <think>t</think> body ', annotations: [] } },
        { type: 'tool_call', tool_call_id: 'c1', tool_name: 'x', input: { a: 1 } },
        { type: 'tool_call', tool_call_id: 'c2', tool_name: 'y', input: {} },
      ],
      metadata: { toolErrors: { c1: 'boom' }, parentId: 'u1' },
    })
    const back = convertThreadMessageToUIMessage(record)
    expect(back.parts).toEqual([
      { type: 'reasoning', text: 'r' },
      { type: 'reasoning', text: 't' },
      { type: 'text', text: 'body' },
      { type: 'tool-x', toolCallId: 'c1', input: { a: 1 }, state: 'output-error', errorText: 'boom' },
      { type: 'tool-y', toolCallId: 'c2', input: {}, state: 'input-available' },
    ])
    expect(back.metadata).toEqual({
      toolErrors: { c1: 'boom' },
      parentId: 'u1',
      createdAt: new Date(1000),
    })
  })
})

describe('prompt-cache stability across a reload', () => {
  const user = (id: string, text: string) =>
    ({ id, role: 'user', parts: [{ type: 'text', text }] }) as UIMessage
  const live: UIMessage[] = [
    user('u1', 'list files'),
    assistant([
      { type: 'step-start' },
      { type: 'reasoning', text: 'I should list.', state: 'done', providerMetadata: { anthropic: { signature: 'SIG' } } },
      { type: 'tool-ls', toolCallId: 'c1', state: 'output-available', input: { p: '.' }, output: 'a b', callProviderMetadata: { anthropic: { cache: 1 } } },
      { type: 'step-start' },
      { type: 'text', text: 'Files: a, b\n', state: 'done' },
    ]),
    user('u2', 'thanks'),
  ]
  const request = (messages: UIMessage[]) =>
    convertToModelMessages(
      coalesceMessagesForAlternation(
        resolveOrphanToolCalls(splitAssistantToolWaves(messages))
      )
    )
  const reloadHistory = (
    fields: (m: UIMessage) => { content: any[]; metadata: Record<string, unknown> }
  ) =>
    live.map((m) =>
      m.role === 'assistant'
        ? convertThreadMessageToUIMessage(persist(toRecord(m.id, fields(m))))
        : m
    )

  it('the reloaded request equals the live one', async () => {
    const reloaded = reloadHistory((m) =>
      assistantRecordFields(m, m.metadata as any, {})
    )
    expect(await request(reloaded)).toEqual(await request(live))
  })

  it('differs without uiParts (old path), so the check is meaningful', async () => {
    const reloaded = reloadHistory((m) => oldFields(m, m.metadata as any))
    expect(await request(reloaded)).not.toEqual(await request(live))
  })
})


describe('a realistic streamed turn', () => {
  const longText = `\n\nHere is the listing. ${'Lorem ipsum dolor sit amet. '.repeat(40)}`
  const reasoning = `I will list the directory. ${'Thinking hard. '.repeat(30)}`
  const toolOutput = `file-${'x'.repeat(600)}`
  const png = `data:image/png;base64,${'Q'.repeat(400)}`
  const streamed = assistant([
    { type: 'step-start' },
    { type: 'reasoning', text: reasoning, state: 'done', providerMetadata: { anthropic: { signature: 'SIG-123' } } },
    { type: 'text', text: longText, state: 'done' },
    { type: 'tool-ls', toolCallId: 'c1', state: 'output-available', input: { path: '/p' }, output: toolOutput },
    { type: 'step-start' },
    { type: 'file', mediaType: 'image/png', url: png },
    { type: 'text', text: 'Done.\n', state: 'done' },
  ])
  const count = (hay: string, needle: string) => hay.split(needle).length - 1

  it('stores media once and reloads losslessly', () => {
    const record = build(streamed)
    const json = JSON.stringify(record)
    expect(record.metadata?.uiParts).toBeDefined()
    expect(count(json, 'Q'.repeat(400))).toBe(1)
    expect(count(json, toolOutput)).toBe(1)
    expect(reload(streamed)).toEqual([
      { type: 'step-start' },
      { type: 'reasoning', text: reasoning, providerMetadata: { anthropic: { signature: 'SIG-123' } } },
      { type: 'text', text: longText },
      { type: 'tool-ls', toolCallId: 'c1', state: 'output-available', input: { path: '/p' }, output: toolOutput },
      { type: 'step-start' },
      { type: 'file', mediaType: 'image/png', url: png },
      { type: 'text', text: 'Done.\n' },
    ])
    const old = JSON.stringify(toRecord('a1', oldFields(streamed, undefined)))
    // The carrier copies text and reasoning; media and tool output stay once.
    expect(json.length).toBeLessThan(old.length * 2)
  })

  // Any writer that changes `content` invalidates the carrier.
  const edits: Record<string, (content: any[]) => any[]> = {
    'entries reordered': (c) => [c[1], c[0], ...c.slice(2)],
    'a text edited': (c) =>
      c.map((e, i) => (i === 1 ? { ...e, text: { ...e.text, value: 'edited' } } : e)),
    'an entry removed': (c) => c.slice(0, -1),
    'an entry appended': (c) => [...c, { type: 'text', text: { value: 'more', annotations: [] } }],
  }
  for (const [name, edit] of Object.entries(edits)) {
    it(`falls back when content has ${name}`, () => {
      const record = persist(build(streamed))
      const edited = { ...record, content: edit(record.content as any[]) } as ThreadMessage
      const back = convertThreadMessageToUIMessage(edited)
      expect(back.parts).toEqual(legacyReload(edited))
      expect((back.metadata as any).uiParts).toBeUndefined()
    })
  }

  // The tool output lives only in `content`, so `content` stays its authority.
  it('reloads a tool output changed in content from content', () => {
    const record = persist(build(streamed))
    const content = (record.content as any[]).map((e) =>
      e.type === 'tool_call' ? { ...e, output: 'other' } : e
    )
    const back = convertThreadMessageToUIMessage({ ...record, content } as ThreadMessage)
    expect(back.parts).toEqual(
      reload(streamed).map((p: any) => (p.type === 'tool-ls' ? { ...p, output: 'other' } : p))
    )
  })
})

describe('traps', () => {
  it('canonical compare ignores undefined keys dropped by storage', () => {
    const message = assistant([
      { type: 'text', text: 'a ', providerMetadata: undefined },
      { type: 'tool-x', toolCallId: 'c1', state: 'output-available', input: undefined, output: '' },
    ])
    const record = build(message)
    expect((record.content[1] as any)).toHaveProperty('input', undefined)
    expect(reload(message)).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'tool-x', toolCallId: 'c1', state: 'output-available', output: '' },
    ])
  })

  it("an old build's Stop rewrite invalidates uiParts and falls back", () => {
    const running = assistant([
      { type: 'step-start' },
      { type: 'text', text: 'checking ' },
      { type: 'tool-x', toolCallId: 'c1', state: 'input-available', input: { a: 1 } },
    ])
    const record = persist(build(running))
    expect(record.metadata?.uiParts).toBeDefined()
    // The old rewriteStoredTurn: new content, stored metadata spread as-is.
    const finished = assistant([
      { type: 'step-start' },
      { type: 'text', text: 'checking ' },
      { type: 'tool-x', toolCallId: 'c1', state: 'output-available', input: { a: 1 }, output: 'ok' },
    ])
    const old = oldFields(finished, record.metadata as any, true)
    const rewritten = persist({ ...record, ...old } as ThreadMessage)
    expect((rewritten.metadata as any).uiParts).toBeDefined()
    expect(convertThreadMessageToUIMessage(rewritten).parts).toEqual([
      { type: 'text', text: 'checking' },
      { type: 'tool-x', toolCallId: 'c1', input: { a: 1 }, state: 'output-available', output: 'ok' },
    ])
  })

  it('raw <think> in live text round-trips as text', () => {
    const message = assistant([{ type: 'text', text: 'see <think>x</think> y' }])
    expect(build(message).metadata?.uiParts).toBeDefined()
    expect(reload(message)).toEqual([{ type: 'text', text: 'see <think>x</think> y' }])
  })

  it('a png keeps image/png although content implies jpeg', () => {
    const message = assistant([{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' }])
    const record = persist(build(message))
    expect(legacyReload(record)).toEqual([
      { type: 'file', mediaType: 'image/jpeg', url: 'data:image/png;base64,AAAA' },
    ])
    expect(convertThreadMessageToUIMessage(record).parts).toEqual([
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' },
    ])
  })

})

