import { isChatRunNotice, withoutChatRunNotices } from '../chatRunNotice'
import type { ThreadMessage } from '@janhq/core'
import { assistantRecordFields, convertThreadMessageToUIMessage } from '../messages'
import { describe, it, expect, vi } from 'vitest'
import { convertToModelMessages, readUIMessageStream, type UIMessageChunk, type UIMessage } from 'ai'
import { conversationDiffs } from '../conversationPanels'
import { TOOL_DIFF_MAX_CHARS } from '../toolDiff'
import { canContinueStoppedTurn, createChatRunStream, taskStatusRows, TASK_STATUS_PART } from '../chatRunTransport'
import { expandChatRunContext, RUN_CONTEXT_PART, RUN_CONTEXT_MAX_CHARS } from '../chatRunContext'
import { PING_OPEN, PING_CLOSE } from '../coworkPing'

const stream = (chunks: UIMessageChunk[]) => new ReadableStream<UIMessageChunk>({ start(c) { chunks.forEach(v => c.enqueue(v)); c.close() } })
const user: UIMessage = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'fixture' }] }
async function consume(s: ReadableStream<UIMessageChunk>) {
  let message: UIMessage | undefined
  for await (const m of readUIMessageStream({ stream: s })) message = m
  return message!
}
const answer: UIMessageChunk[] = [
  { type: 'start' }, { type: 'start-step' },
  { type: 'text-start', id: '0' }, { type: 'text-delta', id: '0', delta: 'done' }, { type: 'text-end', id: '0' },
  { type: 'finish-step' }, { type: 'finish' },
]
describe('Chat runTurn stream adapter (real SDK reader and runner)', () => {
  it('keeps canonical signatures/sources/tool metadata in next request and one live message', async () => {
    const first: UIMessageChunk[] = [
      { type: 'start' }, { type: 'start-step' },
      { type: 'reasoning-start', id: '0' },
      { type: 'reasoning-delta', id: '0', delta: 'thinking', providerMetadata: { anthropic: { signature: 'fixture-signature' } } },
      { type: 'reasoning-end', id: '0' },
      { type: 'source-url', sourceId: 'source', url: 'https://example.invalid/fixture' },
      { type: 'tool-input-available', toolCallId: 'call', toolName: 'fixture', input: {}, providerMetadata: { anthropic: { signature: 'tool-signature' } } },
      { type: 'finish-step' }, { type: 'finish' },
    ]
    const send = vi.fn().mockResolvedValueOnce(stream(first)).mockResolvedValueOnce(stream(answer))
    const dispatch = vi.fn().mockResolvedValue({ output: 'fixture result' })
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch }))
    expect(send).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenCalledTimes(1)
    const history = send.mock.calls[1][0] as UIMessage[]
    const canonical = await consume(stream(first))
    expect(history[1].parts.slice(0, -1)).toEqual(canonical.parts.slice(0, -1))
    expect(history[1].parts.at(-1)).toMatchObject({ state: 'output-available', output: 'fixture result', callProviderMetadata: { anthropic: { signature: 'tool-signature' } } })
    const stored = JSON.parse(JSON.stringify({
      id: message.id, thread_id: 'fixture', role: 'assistant', status: 'ready', object: 'thread.message', created_at: 1, completed_at: 1,
      ...assistantRecordFields(message, {}, { stopped: false }),
    })) as ThreadMessage
    const reloaded = convertThreadMessageToUIMessage(stored)
    expect(reloaded.parts).toEqual(message.parts)
    expect(await convertToModelMessages([user, reloaded])).toEqual(await convertToModelMessages([user, message]))
    // Negative control: the legacy content-only carrier loses signatures and sources.
    const legacy = convertThreadMessageToUIMessage({ ...stored, metadata: {} })
    expect(legacy.parts).not.toEqual(message.parts)
    expect(message.id).toBe('a')
    expect(message.parts).toEqual([...history[1].parts, { type: 'step-start' }, { type: 'text', text: 'done', state: 'done' }])
  })
  it('uses the accumulated live assistant as the exact next request across three steps (negative control: separate rows differs)', async () => {
    const tool = (id: string): UIMessageChunk[] => [{ type: 'start-step' }, { type: 'tool-input-available', toolCallId: id, toolName: 'fixture', input: { id } }, { type: 'finish-step' }, { type: 'finish' }]
    const send = vi.fn().mockResolvedValueOnce(stream(tool('c1'))).mockResolvedValueOnce(stream(tool('c2'))).mockResolvedValueOnce(stream(answer))
    const outputs = [{ value: 1 }, ['typed', false]]
    let n = 0
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch: async () => ({ output: outputs[n++] }) }))
    const beforeFinal = send.mock.calls[2][0] as UIMessage[]
    expect(beforeFinal).toHaveLength(2)
    expect(beforeFinal[1].id).toBe('a')
    expect(beforeFinal[1].parts).toEqual(message.parts.slice(0, -2))
    expect(await convertToModelMessages(beforeFinal)).toEqual(await convertToModelMessages([user, { ...message, parts: message.parts.slice(0, -2) }]))
    // A split Cowork projection changes grouping and is not our authority.
    expect(beforeFinal).not.toEqual([user, { ...beforeFinal[1], parts: beforeFinal[1].parts.slice(0, 2) }, { ...beforeFinal[1], id: 'second', parts: beforeFinal[1].parts.slice(2) }])
    expect(beforeFinal[1].parts.filter(p => 'toolCallId' in p).map(p => 'output' in p ? p.output : undefined)).toEqual(outputs)
  })
  it('cancels the shared stream source and finishes the run when its consumer cancels', async () => {
    const cancelled = vi.fn()
    const outcome = vi.fn()
    const source = new ReadableStream<UIMessageChunk>({ cancel: cancelled })
    const send = vi.fn().mockResolvedValue(source)
    const wrapped = createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch: vi.fn(), onOutcome: outcome })
    const reader = wrapped.getReader()
    await reader.read()
    await reader.cancel('fixture stop')
    await vi.waitFor(() => expect(outcome).toHaveBeenCalled())
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(outcome.mock.calls[0][0].stoppedBy).toBe('aborted')
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('does not locally execute provider-executed tools', async () => {
    const send = vi.fn().mockResolvedValue(stream([
      { type: 'tool-input-available', toolCallId: 'hosted', toolName: 'fixture', input: {}, providerExecuted: true },
      { type: 'tool-output-available', toolCallId: 'hosted', output: { typed: ['result'] }, providerExecuted: true },
      ...answer,
    ]))
    const dispatch = vi.fn()
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch }))
    expect(dispatch).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
    expect(message.parts.find(p => 'toolCallId' in p)).toMatchObject({ output: { typed: ['result'] } })
  })
  it('runs same-wave calls serially, settles queued calls on Stop, and makes no follow-up', async () => {
    const abort = new AbortController()
    let finish!: (outcome: { output: string }) => void
    const dispatch = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const send = vi.fn().mockResolvedValue(stream(['a', 'b', 'c'].map(toolCallId => ({ type: 'tool-input-available' as const, toolCallId, toolName: 'fixture', input: {} }))))
    const consumed = consume(createChatRunStream({ messages: [user], messageId: 'a', signal: abort.signal, sendStep: send, dispatch }))
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    abort.abort('Stop')
    const message = await consumed
    finish({ output: 'late result discarded' })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(message.parts.filter(p => 'toolCallId' in p)).toHaveLength(3)
    expect(message.parts.filter(p => 'toolCallId' in p).every(p => 'state' in p && p.state === 'output-error')).toBe(true)
  })
  it('preserves tool image encoding and typed empty results through next request', async () => {
    const send = vi.fn().mockResolvedValueOnce(stream([{ type: 'tool-input-available', toolCallId: 'img', toolName: 'fixture', input: {} }])).mockResolvedValueOnce(stream(answer))
    const dispatch = vi.fn().mockResolvedValue({ output: 'image', images: [{ dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png' }] })
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch }))
    expect((send.mock.calls[1][0] as UIMessage[])[1].parts).toEqual(message.parts.slice(0, -2))
    expect(message.parts[0]).toMatchObject({ state: 'output-available', output: expect.stringContaining('data:image/png;base64,AAAA') })
  })
  it('fails closed on SDK approval and malformed stream before dispatch', async () => {
    for (const bad of [
      { type: 'tool-approval-request', approvalId: 'sdk', toolCallId: 'c' },
      { type: 'text-delta', id: 'missing-start', delta: 'broken' },
    ] as UIMessageChunk[]) {
      const dispatch = vi.fn()
      const outcome = vi.fn()
      const send = vi.fn().mockResolvedValue(stream([{ type: 'tool-input-available', toolCallId: 'c', toolName: 'fixture', input: {} }, bad, { type: 'finish' }]))
      await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch, onOutcome: outcome })).catch(() => {})
      await vi.waitFor(() => expect(outcome).toHaveBeenCalledTimes(1))
      expect(dispatch).not.toHaveBeenCalled()
      expect(outcome.mock.calls[0][0].stoppedBy).toBe('error')
    }
  })
  it('rejects reused tool ids without a second execution or output', async () => {
    const wave: UIMessageChunk[] = [{ type: 'tool-input-available', toolCallId: 'c', toolName: 'fixture', input: {} }, { type: 'finish' }]
    const dispatch = vi.fn().mockResolvedValue({ output: 'once' })
    const send = vi.fn().mockImplementation(() => Promise.resolve(stream(wave)))
    const outcome = vi.fn()
    await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch, onOutcome: outcome })).catch(() => {})
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(2)
    expect(outcome.mock.calls[0][0].errorText).toContain('Duplicate tool call id')
  })
  it('Stop settles a hung dispatch once and never requests another step', async () => {
    const abort = new AbortController()
    const send = vi.fn().mockResolvedValue(stream([{ type: 'tool-input-available', toolCallId: 'c', toolName: 'fixture', input: {} }, { type: 'finish' }]))
    const dispatch = vi.fn().mockImplementation(() => { abort.abort('fixture Stop'); return new Promise(() => {}) })
    const outcome = vi.fn()
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: abort.signal, sendStep: send, dispatch, onOutcome: outcome }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(message.parts[0]).toMatchObject({ state: 'output-error', errorText: 'Stopped before the tool finished.' })
    expect(outcome.mock.calls[0][0].stoppedBy).toBe('aborted')
  })
  it('surfaces step exhaustion as an actionable stopped turn, not success', async () => {
    const send = vi.fn().mockResolvedValue(stream([{ type: 'tool-input-available', toolCallId: 'c', toolName: 'fixture', input: {} }]))
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, maxSteps: 1, sendStep: send, dispatch: async () => ({ output: 'done' }) }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(message.metadata).toMatchObject({ stopped: true, runStopReason: 'steps' })
    expect(message.parts.at(-1)).toMatchObject({ type: 'text', text: expect.stringContaining('step limit') })
    expect(isChatRunNotice(message.parts.at(-1)!)).toBe(true)
    const stored = JSON.parse(JSON.stringify({ id: message.id, role: 'assistant', thread_id: 'fixture', ...assistantRecordFields(message, {}, {}) })) as ThreadMessage
    const reloaded = convertThreadMessageToUIMessage(stored)
    expect(isChatRunNotice(reloaded.parts.at(-1)!)).toBe(true)
    expect(withoutChatRunNotices([reloaded])[0].parts).toEqual(message.parts.slice(0, -1))
  })
  it('gates Continue: stopped turns resume from settled tool waves or partial text; notices and in-flight tools never qualify', () => {
    const notice = { type: 'text' as const, text: 'Stopped at the step limit.', providerMetadata: { jan: { chatRunNotice: true } } }
    const tool = { type: 'tool-fixture', toolCallId: 'c', state: 'output-available', input: {}, output: 'done' } as unknown as UIMessage['parts'][number]
    const text = { type: 'text' as const, text: 'partial' }
    const capped = { stopped: true, runStopReason: 'steps' }
    // Capped tool-only turns must offer Continue — the working path resumes
    // them from kept history. The notice alone never qualifies.
    expect(canContinueStoppedTurn(capped, [tool, notice])).toBe(true)
    expect(canContinueStoppedTurn(capped, [notice])).toBe(false)
    expect(canContinueStoppedTurn({ stopped: true, runStopReason: 'tokens' }, [tool, notice])).toBe(true)
    // User-stopped turns resume from settled tool waves (kept history) or
    // partial text; a tool still in flight is not a resume point.
    expect(canContinueStoppedTurn({ stopped: true }, [tool])).toBe(true)
    const inFlight = { type: 'tool-fixture', toolCallId: 'c', state: 'input-available', input: {} } as unknown as UIMessage['parts'][number]
    expect(canContinueStoppedTurn({ stopped: true }, [inFlight])).toBe(false)
    expect(canContinueStoppedTurn({ stopped: true }, [text])).toBe(true)
    expect(canContinueStoppedTurn({ stopped: true }, [{ type: 'text', text: '  ' }])).toBe(false)
    expect(canContinueStoppedTurn(undefined, [text])).toBe(false)
    expect(canContinueStoppedTurn({ stopped: true, runStopReason: 'steps' }, [text, notice])).toBe(true)
  })
  it('surfaces token exhaustion as a stopped turn with continuation text', async () => {
    const send = vi.fn().mockResolvedValue(stream([{ type: 'tool-input-available', toolCallId: 'c', toolName: 'fixture', input: {} }, { type: 'finish', messageMetadata: { usage: { inputTokens: 250000, outputTokens: 1001, totalTokens: 251001 } } }]))
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, modelContextTokens: 1000, sendStep: send, dispatch: async () => ({ output: 'done' }) }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(message.metadata).toMatchObject({ stopped: true, runStopReason: 'tokens' })
    expect(message.parts.at(-1)).toMatchObject({ type: 'text', text: expect.stringContaining('token limit') })
  })
  it('does not charge a 250k replayed prompt against a 1M Chat model budget', async () => {
    const send = vi.fn().mockResolvedValueOnce(stream([{ type: 'tool-input-available', toolCallId: 'large', toolName: 'fixture', input: {} }, { type: 'finish', messageMetadata: { usage: { inputTokens: 250000, outputTokens: 10, totalTokens: 250010 } } }])).mockResolvedValueOnce(stream(answer))
    const outcome = vi.fn()
    await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, modelContextTokens: 1000000, sendStep: send, dispatch: async () => ({ output: 'done' }), onOutcome: outcome }))
    expect(send).toHaveBeenCalledTimes(2)
    expect(outcome.mock.calls[0][0]).toMatchObject({ stoppedBy: 'done', sessionTokens: 10 })
  })
  it('direct unsupported-model path makes exactly one request and no dispatch', async () => {
    const send = vi.fn().mockResolvedValue(stream(answer))
    const dispatch = vi.fn()
    await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(dispatch).not.toHaveBeenCalled()
  })
  it('emits task dispatch + completion as canonical data parts through the one runTurn inbox, persisted and never shown to the model', async () => {
    const taskCall: UIMessageChunk[] = [{ type: 'start-step' }, { type: 'tool-input-available', toolCallId: 'tk', toolName: 'task', input: {} }, { type: 'finish-step' }, { type: 'finish' }]
    const send = vi.fn().mockResolvedValueOnce(stream(taskCall)).mockResolvedValueOnce(stream(answer)).mockResolvedValueOnce(stream(answer))
    const rows: unknown[][] = []
    const notices: string[] = []
    let owed = false
    let wake: () => void = () => {}
    const dispatch = vi.fn(async () => {
      // Dispatch receipt only; the child runs in the background.
      owed = true
      rows.push([{ runId: 'tk:a', name: 'a', status: 'running', startedAt: 10 }])
      setTimeout(() => {
        rows.push([{ runId: 'tk:a', name: 'a', status: 'done', startedAt: 10, endedAt: 20, finalOutput: 'the answer' }])
        notices.push("Subagent 'a' (tk:a) finished. Its answer:\n\nthe answer")
        wake()
      }, 5)
      return { output: 'Dispatched 1 subagent(s)' }
    })
    const inbox = {
      take: () => { const t = notices.splice(0); if (t.length) owed = false; return t },
      pending: () => owed || notices.length > 0,
      wait: () => new Promise<void>((resolve) => { wake = resolve; if (notices.length) resolve() }),
      takeStatus: () => rows.splice(0).flat(),
    }
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch, inbox }))
    // Task dispatch step + the answer step + exactly one step to read the ping: the existing runTurn loop, no extra model loop.
    expect(send).toHaveBeenCalledTimes(3)
    expect(dispatch).toHaveBeenCalledTimes(1)
    const parts = message.parts.filter(p => p.type === TASK_STATUS_PART)
    // Same stable part id: the completion row REPLACES the dispatch row in place.
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ id: 'task-status:tk:a', data: { subagents: [{ runId: 'tk:a', status: 'done', endedAt: 20, finalOutput: 'the answer' }] } })
    expect(taskStatusRows([message])).toEqual([{ runId: 'tk:a', name: 'a', status: 'done', startedAt: 10, endedAt: 20, finalOutput: 'the answer' }])
    // The tool result stays the dispatch receipt, never the child's answer.
    expect(message.parts.find(p => 'toolCallId' in p)).toMatchObject({ output: 'Dispatched 1 subagent(s)' })
    // Data parts never reach the model.
    for (const call of send.mock.calls) {
      const model = await convertToModelMessages(call[0] as UIMessage[])
      expect(JSON.stringify(model)).not.toContain('task-status')
    }
    // Persisted and reloaded losslessly (no unsupported-part fallback).
    const stored = JSON.parse(JSON.stringify({
      id: message.id, thread_id: 'fixture', role: 'assistant', status: 'ready', object: 'thread.message', created_at: 1, completed_at: 1,
      ...assistantRecordFields(message, {}, { stopped: false }),
    })) as ThreadMessage
    expect(stored.metadata).not.toHaveProperty('uiPartsSkipped')
    expect(taskStatusRows([convertThreadMessageToUIMessage(stored)])).toEqual(taskStatusRows([message]))
  })
  it('round-trips data-task-status and data-tool-diff together canonically and omits both from the model', async () => {
    const diff = '-    1 | secretdiffbody\n+    1 | other'
    const calls: UIMessageChunk[] = [
      { type: 'start-step' },
      { type: 'tool-input-available', toolCallId: 'tk', toolName: 'task', input: {} },
      { type: 'tool-input-available', toolCallId: 'e1', toolName: 'edit', input: { path: 'a.txt' } },
      { type: 'finish-step' }, { type: 'finish' },
    ]
    const send = vi.fn().mockResolvedValueOnce(stream(calls)).mockResolvedValueOnce(stream(answer)).mockResolvedValueOnce(stream(answer))
    const rows: unknown[][] = []
    const notices: string[] = []
    let owed = false
    let wake: () => void = () => {}
    const dispatch = vi.fn(async (call: { toolName: string }) => {
      if (call.toolName === 'edit') return { output: 'Edited a.txt', diff }
      owed = true
      rows.push([{ runId: 'tk:a', name: 'a', status: 'running', startedAt: 10 }])
      setTimeout(() => {
        rows.push([{ runId: 'tk:a', name: 'a', status: 'done', startedAt: 10, endedAt: 20, finalOutput: 'child answer' }])
        notices.push("Subagent 'a' (tk:a) finished. Its answer:\n\nchild answer")
        wake()
      }, 5)
      return { output: 'Dispatched 1 subagent(s)' }
    })
    const inbox = {
      take: () => { const t = notices.splice(0); if (t.length) owed = false; return t },
      pending: () => owed || notices.length > 0,
      wait: () => new Promise<void>((resolve) => { wake = resolve; if (notices.length) resolve() }),
      takeStatus: () => rows.splice(0).flat(),
    }
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch, inbox }))
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(message.parts.filter(p => p.type === TASK_STATUS_PART)).toHaveLength(1)
    expect(message.parts.filter(p => p.type === 'data-tool-diff')).toHaveLength(1)
    // The model never sees either display-only part, at any step.
    for (const call of send.mock.calls) {
      const model = JSON.stringify(await convertToModelMessages(call[0] as UIMessage[]))
      expect(model).not.toContain('task-status')
      expect(model).not.toContain('tool-diff')
      expect(model).not.toContain('secretdiffbody')
    }
    const fields = assistantRecordFields(message, {}, { stopped: false })
    expect(fields.metadata).not.toHaveProperty('uiPartsSkipped')
    expect(fields.metadata).not.toHaveProperty('uiDiffsOmitted')
    expect(JSON.stringify(fields.content)).not.toContain('secretdiffbody')
    const stored = JSON.parse(JSON.stringify({ id: 'a', thread_id: 't', role: 'assistant', status: 'ready', object: 'thread.message', created_at: 1, completed_at: 1, ...fields })) as ThreadMessage
    const reloaded = convertThreadMessageToUIMessage(stored)
    // Canonical: the same parts, in the same order, with the same ids.
    expect(reloaded.parts).toEqual(message.parts)
    expect(taskStatusRows([reloaded])).toEqual([{ runId: 'tk:a', name: 'a', status: 'done', startedAt: 10, endedAt: 20, finalOutput: 'child answer' }])
    expect(conversationDiffs([reloaded]).map(f => [f.path, f.operations[0].diff])).toEqual([['a.txt', diff]])
    // Model projection of the reloaded message equals the one with both data parts removed.
    const displayOnly = (p: { type: string }) => p.type === TASK_STATUS_PART || p.type === 'data-tool-diff'
    expect(await convertToModelMessages([user, reloaded])).toEqual(await convertToModelMessages([user, { ...message, parts: message.parts.filter(p => !displayOnly(p)) }]))
    expect(JSON.stringify(await convertToModelMessages([user, reloaded]))).not.toMatch(/secretdiffbody|task-status|tool-diff/)
  })
  it('keeps working without a status source: a plain inbox emits no data parts', async () => {
    const send = vi.fn().mockResolvedValue(stream(answer))
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch: vi.fn(), inbox: { take: () => [], pending: () => false, wait: async () => {} } }))
    expect(message.parts.some(p => p.type === TASK_STATUS_PART)).toBe(false)
  })
  it('normalizes a dispatch exception without a second dispatch', async () => {
    const send = vi.fn().mockResolvedValueOnce(stream([{ type: 'tool-input-available', toolCallId: 'c', toolName: 'fixture', input: {} }, { type: 'finish' }])).mockResolvedValueOnce(stream(answer))
    const dispatch = vi.fn().mockRejectedValue(new Error('fixture denied'))
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch }))
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(message.parts.find(p => 'toolCallId' in p)).toMatchObject({ state: 'output-error', errorText: 'fixture denied' })
  })
  it('emits the display-only diff as a separate data part that persists and never reaches the model', async () => {
    // The actual edit-diff format (no `@@` header), as the Rust handler renders it.
    const diff = '-    1 | foo\n+    1 | bar'
    const call: UIMessageChunk[] = [{ type: 'start-step' }, { type: 'tool-input-available', toolCallId: 'e1', toolName: 'edit', input: { path: 'a.txt' } }, { type: 'finish-step' }, { type: 'finish' }]
    const send = vi.fn().mockResolvedValueOnce(stream(call)).mockResolvedValueOnce(stream(answer))
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch: async () => ({ output: 'Edited a.txt', diff }) }))
    const dataPart = message.parts.find(p => p.type === 'data-tool-diff')
    expect(dataPart).toMatchObject({ data: { toolCallId: 'e1', diff } })
    expect(message.parts.find(p => 'toolCallId' in p && p.type === 'tool-edit')).toMatchObject({ output: 'Edited a.txt' })
    expect(JSON.stringify(send.mock.calls[1][0])).not.toContain('foo')
    const fields = assistantRecordFields(message, {}, { stopped: false })
    expect(JSON.stringify(fields.content)).not.toContain('foo')
    const stored = JSON.parse(JSON.stringify({ id: 'a', thread_id: 't', role: 'assistant', status: 'ready', object: 'thread.message', created_at: 1, completed_at: 1, ...fields })) as ThreadMessage
    const reloaded = convertThreadMessageToUIMessage(stored)
    expect(reloaded.parts).toEqual(message.parts)
    expect(await convertToModelMessages([user, reloaded])).toEqual(await convertToModelMessages([user, { ...message, parts: message.parts.filter(p => p.type !== 'data-tool-diff') }]))
    expect(JSON.stringify(await convertToModelMessages([user, reloaded]))).not.toContain('foo')
    // The panel shows the persisted diff after reload.
    expect(conversationDiffs([reloaded]).map(f => [f.path, f.operations[0].diff])).toEqual([['a.txt', diff]])
  })
  it('does not emit an oversized diff, and a data part with no settled call is not stored', async () => {
    const big = '+ ' + 'x'.repeat(TOOL_DIFF_MAX_CHARS)
    const call: UIMessageChunk[] = [{ type: 'start-step' }, { type: 'tool-input-available', toolCallId: 'e1', toolName: 'edit', input: { path: 'a.txt' } }, { type: 'finish-step' }, { type: 'finish' }]
    const send = vi.fn().mockResolvedValueOnce(stream(call)).mockResolvedValueOnce(stream(answer))
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch: async () => ({ output: 'ok', diff: big }) }))
    expect(message.parts.some(p => p.type === 'data-tool-diff')).toBe(false)
    const orphan: UIMessage = { id: 'o', role: 'assistant', parts: [{ type: 'data-tool-diff', id: 'x', data: { toolCallId: 'nope', diff: '+ a' } } as never, { type: 'text', text: 'hi' }] }
    const fields = assistantRecordFields(orphan, {}, { stopped: false })
    expect(fields.metadata).toMatchObject({ uiPartsSkipped: expect.anything() })
    expect(JSON.stringify(fields.metadata)).not.toContain('nope')
  })
})


describe('data-run-context: mid-run pings persist and expand once on reload', () => {
  const toolCall = (name: string): UIMessageChunk[] => [{ type: 'start-step' }, { type: 'tool-input-available', toolCallId: 'tc', toolName: name, input: {} }, { type: 'finish-step' }, { type: 'finish' }]
  const text = (t: string): UIMessageChunk[] => [{ type: 'start' }, { type: 'start-step' }, { type: 'text-start', id: '0' }, { type: 'text-delta', id: '0', delta: t }, { type: 'text-end', id: '0' }, { type: 'finish-step' }, { type: 'finish' }]
  const joined = (messages: unknown) => JSON.stringify(messages)
  for (const [kind, notice] of [
    ['task', "Subagent 'a' (tk:a) finished. Its answer:\n\nUNIQUE-TASK-ANSWER"],
    ['monitor', "Monitor 'm' fired:\n\nUNIQUE-MONITOR-ANSWER"],
  ] as const) {
    it(`${kind} ping: live run sees it once; reload expands it once as a user turn`, async () => {
      const send = vi.fn().mockResolvedValueOnce(stream(toolCall(kind))).mockResolvedValueOnce(stream(text('ack'))).mockResolvedValueOnce(stream(text('final')))
      const notices: string[] = []
      let owed = false
      let wake: () => void = () => {}
      const inbox = {
        take: () => { const t = notices.splice(0); if (t.length) owed = false; return t },
        pending: () => owed || notices.length > 0,
        wait: () => new Promise<void>((resolve) => { wake = resolve; if (notices.length) resolve() }),
      }
      const dispatch = vi.fn(async () => {
        owed = true
        setTimeout(() => { notices.push(notice); wake() }, 5)
        return { output: 'Dispatched' }
      })
      const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch, inbox }))
      expect(send).toHaveBeenCalledTimes(3)
      const ctx = message.parts.filter(p => p.type === RUN_CONTEXT_PART)
      expect(ctx).toHaveLength(1)
      // Live: the canonical history branch never adds the data part, so the model sees the ping once.
      const live = joined(await convertToModelMessages(expandChatRunContext(send.mock.calls[2][0] as UIMessage[])))
      expect(live.split(`UNIQUE-${kind.toUpperCase()}-ANSWER`)).toHaveLength(2)
      expect(joined(send.mock.calls[2][0])).not.toContain(RUN_CONTEXT_PART)
      // Serialize / reload.
      const stored = JSON.parse(JSON.stringify({
        id: message.id, thread_id: 'fixture', role: 'assistant', status: 'ready', object: 'thread.message', created_at: 1, completed_at: 1,
        ...assistantRecordFields(message, {}, { stopped: false }),
      })) as ThreadMessage
      expect(stored.metadata).not.toHaveProperty('uiPartsSkipped')
      const reloaded = convertThreadMessageToUIMessage(stored)
      expect(reloaded.parts.filter(p => p.type === RUN_CONTEXT_PART)).toHaveLength(1)
      const expanded = expandChatRunContext([user, reloaded])
      expect(expanded.some(m => m.parts.some(p => p.type === RUN_CONTEXT_PART))).toBe(false)
      const model = await convertToModelMessages(expanded)
      const holders = model.filter(m => joined(m).includes(`UNIQUE-${kind.toUpperCase()}-ANSWER`))
      expect(holders).toHaveLength(1)
      expect(holders[0].role).toBe('user')
      expect(joined(holders[0])).toContain(PING_OPEN)
      expect(joined(holders[0])).toContain(PING_CLOSE)
      expect(joined(model).split(`UNIQUE-${kind.toUpperCase()}-ANSWER`)).toHaveLength(2)
    })
  }
  it('plain chat is unchanged: one call, no run-context part', async () => {
    const send = vi.fn().mockResolvedValueOnce(stream(text('hi')))
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch: vi.fn() }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(message.parts.some(p => p.type === RUN_CONTEXT_PART)).toBe(false)
  })
  it('expands in order, strips the part, and drops invalid or oversized data', () => {
    const ctx = (data: unknown) => ({ type: RUN_CONTEXT_PART, data }) as never
    const a: UIMessage = { id: 'm', role: 'assistant', parts: [{ type: 'text', text: 'one' }, ctx({ text: 'P1' }), { type: 'text', text: 'two' }, ctx({ text: 'x'.repeat(RUN_CONTEXT_MAX_CHARS + 1) }), ctx({ text: 'P2', extra: 1 }), ctx({ text: 'P3' })] }
    const out = expandChatRunContext([user, a])
    expect(out.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    expect(out.map(m => m.parts.map(p => (p as { text?: string }).text))).toEqual([['fixture'], ['one'], [`${PING_OPEN}\nP1\n${PING_CLOSE}`], ['two'], [`${PING_OPEN}\nP3\n${PING_CLOSE}`]])
    expect(JSON.stringify(out)).not.toContain(RUN_CONTEXT_PART)
    const plain: UIMessage = { id: 'p', role: 'assistant', parts: [{ type: 'text', text: 'x' }, { type: 'data-unknown', data: 1 } as never] }
    expect(expandChatRunContext([plain])[0]).toBe(plain)
  })
  it('does not store an oversized or malformed run-context part', () => {
    const bad = (data: unknown): UIMessage => ({ id: 'b', role: 'assistant', parts: [{ type: RUN_CONTEXT_PART, data } as never, { type: 'text', text: 'hi' }] })
    for (const data of [{ text: 'x'.repeat(RUN_CONTEXT_MAX_CHARS + 1) }, { text: 1 }, { text: 'a', other: 1 }, 'str'])
      expect(assistantRecordFields(bad(data), {}, { stopped: false }).metadata).toMatchObject({ uiPartsSkipped: expect.anything() })
  })
})

describe('optional display diff carrier budget', () => {
  it('omits oversized aggregate display diffs without dropping canonical tool parts', async () => {
    const parts: UIMessage['parts'] = [{ type: 'text', text: 'Kept answer', state: 'done' }]
    for (let i = 0; i < 3; i++) {
      parts.push({ type: 'tool-edit', toolCallId: `d${i}`, state: 'output-available', input: { path: `a${i}.txt` }, output: 'Edited' } as never)
      parts.push({ type: 'data-tool-diff', id: `tool-diff:d${i}`, data: { toolCallId: `d${i}`, diff: '+ '.padEnd(TOOL_DIFF_MAX_CHARS, 'x') } } as never)
    }
    const message: UIMessage = { id: 'aggregate', role: 'assistant', parts }
    const fields = assistantRecordFields(message, {}, { stopped: false })
    expect(fields.metadata.uiPartsSkipped).toBeUndefined()
    expect(fields.metadata.uiDiffsOmitted).toBeGreaterThan(0)
    const stored = JSON.parse(JSON.stringify({ id: message.id, role: 'assistant', thread_id: 'fixture', ...fields })) as ThreadMessage
    const reloaded = convertThreadMessageToUIMessage(stored)
    expect(reloaded.parts.filter(p => p.type !== 'data-tool-diff')).toEqual(parts.filter(p => p.type !== 'data-tool-diff'))
    expect(JSON.stringify(await convertToModelMessages([reloaded]))).not.toContain('xxxxxxxxxx')
  })
})
