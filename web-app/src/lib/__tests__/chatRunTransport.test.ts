import { isChatRunNotice, withoutChatRunNotices } from '../chatRunNotice'
import type { ThreadMessage } from '@janhq/core'
import { assistantRecordFields, convertThreadMessageToUIMessage } from '../messages'
import { describe, it, expect, vi } from 'vitest'
import { convertToModelMessages, readUIMessageStream, type UIMessageChunk, type UIMessage } from 'ai'
import { conversationDiffs } from '../conversationPanels'
import { TOOL_DIFF_MAX_CHARS } from '../toolDiff'
import { canContinueStoppedTurn, createChatRunStream, taskStatusRows, TASK_STATUS_PART } from '../chatRunTransport'
import { expandChatRunContext, RUN_CONTEXT_PART, RUN_CONTEXT_MAX_CHARS, RUN_CONTEXT_TRUNCATION_MARKER } from '../chatRunContext'
import { PING_OPEN, PING_CLOSE } from '../coworkPing'
import {
  TASK_STATUS_TEXT_LIMIT, TASK_STATUS_CARRIER_TEXT_LIMIT, TASK_STATUS_MAX_ROWS_PER_PART, TASK_STATUS_MAX_ID_CHARS,
  TASK_STATUS_TRUNCATION_MARKER, shapeTaskStatusPart,
} from '../chatTaskStatus'
import { makeSibling } from '../message-branching'
import { planCompletionNotice, SUBAGENT_INLINE_MAX } from '../coworkSubagent'

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
  it('replays two long notices with identical bounded text live and after reload, each with a truncation marker', async () => {
    const taskCall: UIMessageChunk[] = [{ type: 'start-step' }, { type: 'tool-input-available', toolCallId: 'tk', toolName: 'task', input: {} }, { type: 'finish-step' }, { type: 'finish' }]
    const send = vi.fn().mockResolvedValueOnce(stream(taskCall)).mockResolvedValueOnce(stream(answer)).mockResolvedValueOnce(stream(answer))
    const longs = ['A', 'B'].map(c => c.repeat(RUN_CONTEXT_MAX_CHARS * 2))
    let pending = false
    let queued: string[] = []
    const inbox = {
      take: () => { const t = queued; queued = []; pending = false; return t },
      pending: () => pending || queued.length > 0,
      wait: async () => { queued = longs },
    }
    const dispatch = vi.fn(async () => { pending = true; queued = longs; return { output: 'Dispatched 1 subagent(s)' } })
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch, inbox }))
    const pingTexts = (messages: UIMessage[]) => messages.flatMap(m => m.parts.flatMap(p => p.type === 'text' && p.text.startsWith(PING_OPEN) ? [p.text] : []))
    const live = pingTexts(send.mock.calls.at(-1)![0] as UIMessage[])
    expect(live).toHaveLength(2)
    const stored = JSON.parse(JSON.stringify({
      id: message.id, thread_id: 'fixture', role: 'assistant', status: 'ready', object: 'thread.message', created_at: 1, completed_at: 1,
      ...assistantRecordFields(message, {}, { stopped: false }),
    })) as ThreadMessage
    const reloaded = pingTexts(expandChatRunContext([convertThreadMessageToUIMessage(stored)]))
    expect(reloaded).toEqual(live)
    live.forEach((text, i) => {
      const body = text.slice(PING_OPEN.length + 1, text.length - PING_CLOSE.length - 1)
      expect(body).toHaveLength(RUN_CONTEXT_MAX_CHARS)
      expect(body.endsWith(RUN_CONTEXT_TRUNCATION_MARKER)).toBe(true)
      expect(body.startsWith(longs[i][0])).toBe(true)
    })
  })
  it('replays a three-child exact-8192 plan notice unbounded-by-marker with identical text live and after reload', async () => {
    const taskCall: UIMessageChunk[] = [{ type: 'start-step' }, { type: 'tool-input-available', toolCallId: 'tk', toolName: 'task', input: {} }, { type: 'finish-step' }, { type: 'finish' }]
    const send = vi.fn().mockResolvedValueOnce(stream(taskCall)).mockResolvedValueOnce(stream(answer))
    const tails = ['PLAN_TAIL_ONE', 'PLAN_TAIL_TWO', 'PLAN_TAIL_THREE']
    const outputs = tails.map(t => 'k'.repeat(SUBAGENT_INLINE_MAX - t.length) + t)
    const notice = planCompletionNotice({
      phaseCount: 2,
      totalSubagents: 4,
      finalPhase: outputs.map((output, i) => ({ name: `c${i}`, result: { output, usage: null, isError: false, sessionTokens: 0 }, savedPath: null })),
    }).text
    expect(notice.length).toBeLessThanOrEqual(RUN_CONTEXT_MAX_CHARS)
    let pending = false
    let queued: string[] = []
    const inbox = {
      take: () => { const t = queued; queued = []; pending = false; return t },
      pending: () => pending || queued.length > 0,
      wait: async () => { queued = [notice] },
    }
    const dispatch = vi.fn(async () => { pending = true; queued = [notice]; return { output: 'Dispatched 1 subagent(s)' } })
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch, inbox }))
    const pingTexts = (messages: UIMessage[]) => messages.flatMap(m => m.parts.flatMap(p => p.type === 'text' && p.text.startsWith(PING_OPEN) ? [p.text] : []))
    const live = pingTexts(send.mock.calls.at(-1)![0] as UIMessage[])
    expect(live).toHaveLength(1)
    tails.forEach(t => expect(live[0]).toContain(t))
    expect(live[0]).not.toContain(RUN_CONTEXT_TRUNCATION_MARKER)
    const stored = JSON.parse(JSON.stringify({
      id: message.id, thread_id: 'fixture', role: 'assistant', status: 'ready', object: 'thread.message', created_at: 1, completed_at: 1,
      ...assistantRecordFields(message, {}, { stopped: false }),
    })) as ThreadMessage
    expect(pingTexts(expandChatRunContext([convertThreadMessageToUIMessage(stored)]))).toEqual(live)
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

describe('task-status rows are an optional carrier budget (never cost the turn its model-visible parts)', () => {
  const row = (i: number, extra: Record<string, unknown> = {}) => ({
    runId: `run-${i}`, name: `child-${i}`, status: 'done', startedAt: 1000 + i, endedAt: 2000 + i,
    finalOutput: `${i}`.repeat(TASK_STATUS_TEXT_LIMIT), ...extra,
  })
  const statusPart = (r: Record<string, unknown>) => ({ type: TASK_STATUS_PART, id: `task-status:${r.runId}`, data: { subagents: [r] } }) as never
  const store = (message: UIMessage, fields: ReturnType<typeof assistantRecordFields>) =>
    JSON.parse(JSON.stringify({ id: message.id, role: 'assistant', thread_id: 'fixture', ...fields })) as ThreadMessage

  it('3 x 100k rows + run-context + reasoning metadata: context survives, no uiPartsSkipped, model pinged once', async () => {
    const parts = [
      { type: 'reasoning', text: 'thinking', state: 'done', providerMetadata: { anthropic: { signature: 'sig-1' } } },
      { type: RUN_CONTEXT_PART, data: { text: 'child-0 finished: ctx-marker-0' } },
      statusPart(row(0)), statusPart(row(1)), statusPart(row(2)),
      { type: RUN_CONTEXT_PART, data: { text: 'child-1 finished: ctx-marker-1' } },
      { type: 'text', text: 'final answer', state: 'done' },
    ] as UIMessage['parts']
    const message: UIMessage = { id: 'budget', role: 'assistant', parts }
    expect(JSON.stringify(parts).length).toBeGreaterThan(256 * 1024)
    const fields = assistantRecordFields(message, {}, { stopped: false })
    expect(fields.metadata).not.toHaveProperty('uiPartsSkipped')
    expect(fields.metadata.uiParts).toBeDefined()
    expect(fields.metadata.uiTaskStatusShed).toMatchObject({ truncated: expect.any(Number) })
    expect(JSON.stringify(fields.metadata.uiParts).length).toBeLessThanOrEqual(256 * 1024)

    const reloaded = convertThreadMessageToUIMessage(store(message, fields))
    // Reasoning provider metadata and both run-context parts are intact and in order.
    expect(reloaded.parts.find(p => p.type === 'reasoning')).toMatchObject({ providerMetadata: { anthropic: { signature: 'sig-1' } } })
    expect(reloaded.parts.filter(p => p.type === RUN_CONTEXT_PART)).toEqual(parts.filter(p => p.type === RUN_CONTEXT_PART))
    // Status identity + timestamps survive; only the bulky text was cut.
    const rows = taskStatusRows([reloaded])
    expect(rows.map(r => [r.runId, r.name, r.status, r.startedAt, r.endedAt])).toEqual([0, 1, 2].map(i => [`run-${i}`, `child-${i}`, 'done', 1000 + i, 2000 + i]))
    // Shed one row at a time, only as far as needed: the count reported matches
    // the rows actually cut, the rest keep their full (live-bounded) text.
    const cut = rows.filter(r => String(r.finalOutput).includes('truncated for storage'))
    expect(cut.length).toBeGreaterThan(0)
    expect(fields.metadata.uiTaskStatusShed).toEqual({ truncated: cut.length })
    for (const r of cut) expect(String(r.finalOutput).length).toBeLessThanOrEqual(TASK_STATUS_CARRIER_TEXT_LIMIT)
    for (const r of rows.filter(r => !cut.includes(r))) expect(r.finalOutput).toBe(row(Number(String(r.runId).slice(4))).finalOutput)
    // The model is pinged once per ping, and never sees task-status.
    const model = JSON.stringify(await convertToModelMessages(expandChatRunContext([user, reloaded])))
    expect(model).not.toContain('task-status')
    expect(model.split('ctx-marker-0').length - 1).toBe(1)
    expect(model.split('ctx-marker-1').length - 1).toBe(1)
    expect(model.split(PING_OPEN).length - 1).toBe(2)
  })

  it('strips status text, then drops status parts, only when truncation is not enough; run-context is never shed', () => {
    const many = Array.from({ length: 120 }, (_, i) => statusPart(row(i, { finalOutput: 'x'.repeat(5000), error: 'e'.repeat(5000) })))
    const parts = [
      { type: RUN_CONTEXT_PART, data: { text: 'keep-me' } },
      ...many,
      { type: 'text', text: 'answer', state: 'done' },
    ] as UIMessage['parts']
    const fields = assistantRecordFields({ id: 'm2', role: 'assistant', parts }, {}, { stopped: false })
    expect(fields.metadata).not.toHaveProperty('uiPartsSkipped')
    expect(fields.metadata.uiTaskStatusShed).toBeDefined()
    const reloaded = convertThreadMessageToUIMessage(store({ id: 'm2', role: 'assistant', parts }, fields))
    expect(reloaded.parts.filter(p => p.type === RUN_CONTEXT_PART)).toHaveLength(1)
    expect(JSON.stringify(fields.metadata.uiParts).length).toBeLessThanOrEqual(256 * 1024)
  })

  it('a malformed status row is dropped and counted, not the carrier', () => {
    const parts = [
      { type: 'reasoning', text: 't', state: 'done', providerMetadata: { anthropic: { signature: 's' } } },
      statusPart(row(0, { finalOutput: 'ok', startedAt: 'nope' })),
      statusPart(row(1, { finalOutput: 'ok', extra: 'x' })),
      statusPart(row(2, { finalOutput: 'ok' })),
      { type: RUN_CONTEXT_PART, data: { text: 'ctx' } },
    ] as UIMessage['parts']
    const message: UIMessage = { id: 'm3', role: 'assistant', parts }
    const fields = assistantRecordFields(message, {}, { stopped: false })
    expect(fields.metadata).not.toHaveProperty('uiPartsSkipped')
    expect(fields.metadata.uiTaskStatusShed).toEqual({ dropped: 2 })
    const reloaded = convertThreadMessageToUIMessage(store(message, fields))
    expect(taskStatusRows([reloaded]).map(r => r.runId)).toEqual(['run-2'])
    expect(reloaded.parts.some(p => p.type === RUN_CONTEXT_PART)).toBe(true)
  })

  it('shed tiers: strip alone is enough for many bulky parts; drop is reached only when identity alone is over budget', () => {
    const bulky = Array.from({ length: 40 }, (_, i) => statusPart(row(i, { finalOutput: 'x'.repeat(5000), error: 'e'.repeat(5000) })))
    const a = assistantRecordFields({ id: 'm5', role: 'assistant', parts: [{ type: RUN_CONTEXT_PART, data: { text: 'ctx' } }, ...bulky] as UIMessage['parts'] }, {}, { stopped: false })
    expect(a.metadata).not.toHaveProperty('uiPartsSkipped')
    expect(a.metadata.uiTaskStatusShed).toMatchObject({ truncated: expect.any(Number), stripped: expect.any(Number) })
    expect(a.metadata.uiTaskStatusShed).not.toHaveProperty('dropped')
    const kept = (a.metadata.uiParts as { parts: { type: string }[] }).parts
    expect(kept.filter(p => p.type === TASK_STATUS_PART)).toHaveLength(40)
    expect(kept.some(p => p.type === RUN_CONTEXT_PART)).toBe(true)

    const bare = Array.from({ length: 1800 }, (_, i) => statusPart({ runId: `run-${i}`, name: `child-${i}`, status: 'running', startedAt: 1000 + i }))
    const b = assistantRecordFields({ id: 'm6', role: 'assistant', parts: [{ type: RUN_CONTEXT_PART, data: { text: 'ctx' } }, ...bare] as UIMessage['parts'] }, {}, { stopped: false })
    expect(b.metadata).not.toHaveProperty('uiPartsSkipped')
    expect(b.metadata.uiTaskStatusShed).toEqual({ dropped: expect.any(Number) })
    const keptB = (b.metadata.uiParts as { parts: { type: string }[] }).parts
    expect(keptB.some(p => p.type === RUN_CONTEXT_PART)).toBe(true)
    expect(keptB.filter(p => p.type === TASK_STATUS_PART)).toHaveLength(1800 - (b.metadata.uiTaskStatusShed as { dropped: number }).dropped)
    expect(JSON.stringify(b.metadata.uiParts).length).toBeLessThanOrEqual(256 * 1024)
  })

  it('shedding many statuses serializes each part a bounded number of times (not once per deletion)', () => {
    const N = 1800
    const bare = Array.from({ length: N }, (_, i) => statusPart({ runId: `run-${i}`, name: `child-${i}`, status: 'running', startedAt: 1000 + i }))
    const message: UIMessage = { id: 'perf1', role: 'assistant', parts: [{ type: RUN_CONTEXT_PART, data: { text: 'ctx' } }, ...bare] as UIMessage['parts'] }
    const spy = vi.spyOn(JSON, 'stringify')
    let fields: ReturnType<typeof assistantRecordFields>
    let calls: number
    try {
      fields = assistantRecordFields(message, {}, { stopped: false })
      calls = spy.mock.calls.length
    } finally {
      spy.mockRestore()
    }
    expect(fields.metadata).not.toHaveProperty('uiPartsSkipped')
    const dropped = (fields.metadata.uiTaskStatusShed as { dropped: number }).dropped
    expect(dropped).toBeGreaterThan(50)
    // Linear in the part count with a small constant; a rebuild per deletion would be ~dropped * N.
    expect(calls).toBeLessThan(10 * N)
    expect(JSON.stringify(fields.metadata.uiParts).length).toBeLessThanOrEqual(256 * 1024)
  })

  it('a huge non-sheddable part fails early with size, without shedding or serializing the statuses repeatedly', () => {
    const many = Array.from({ length: 300 }, (_, i) => statusPart(row(i, { finalOutput: 'x'.repeat(5000) })))
    const parts = [
      { type: 'reasoning', text: 'r'.repeat(300 * 1024), state: 'done' },
      ...many,
      { type: 'text', text: 'answer', state: 'done' },
    ] as UIMessage['parts']
    const spy = vi.spyOn(JSON, 'stringify')
    let fields: ReturnType<typeof assistantRecordFields>
    let calls: number
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      fields = assistantRecordFields({ id: 'perf2', role: 'assistant', parts }, {}, { stopped: false })
      calls = spy.mock.calls.length
    } finally {
      spy.mockRestore()
      warn.mockRestore()
    }
    expect(fields.metadata.uiPartsSkipped).toBe('size')
    expect(fields.metadata).not.toHaveProperty('uiParts')
    expect(fields.metadata).not.toHaveProperty('uiTaskStatusShed')
    expect(calls).toBeLessThan(10 * parts.length)
  })

  it('early size overflow serializes each status part exactly once (guard off would truncate + strip => extra per status)', () => {
    const N = 300
    const many = Array.from({ length: N }, (_, i) => statusPart(row(i, { finalOutput: 'x'.repeat(5000) })))
    const parts = [
      { type: 'reasoning', text: 'r'.repeat(300 * 1024), state: 'done' },
      ...many,
      { type: 'text', text: 'answer', state: 'done' },
    ] as UIMessage['parts']
    const spy = vi.spyOn(JSON, 'stringify')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let fields: ReturnType<typeof assistantRecordFields>
    let statusCalls: number
    try {
      fields = assistantRecordFields({ id: 'perf3', role: 'assistant', parts }, {}, { stopped: false })
      statusCalls = spy.mock.calls.filter(([v]) => (v as { type?: unknown } | null)?.type === TASK_STATUS_PART).length
    } finally {
      spy.mockRestore()
      warn.mockRestore()
    }
    expect(fields.metadata.uiPartsSkipped).toBe('size')
    expect(fields.metadata).not.toHaveProperty('uiParts')
    expect(fields.metadata).not.toHaveProperty('uiTaskStatusShed')
    // Cached stored form: one stringify per status part, no re-serialization while bailing.
    expect(statusCalls).toBe(N)
  })

  describe('carrier boundary with escaped text and pointer parts', () => {
    const LIMIT = 256 * 1024
    const tricky = 'He said "hi"\\ back\nline2\r\n\t\u2028\u2029 \u00e9\u4e2d\ud83d\ude00 \u0000'
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const canonical = (m: UIMessage) => m.parts.filter(p => p.type !== TASK_STATUS_PART)
    // A single status text is capped at TASK_STATUS_TEXT_LIMIT, so canonical filler brings the carrier near the limit.
    const FILLER = 'f'.repeat(200 * 1024)
    const build = (pad: number, id: string): UIMessage => ({
      id, role: 'assistant', parts: [
        { type: 'reasoning', text: tricky, state: 'done', providerMetadata: { anthropic: { signature: 'sig-b' } } },
        { type: RUN_CONTEXT_PART, data: { text: `ctx ${tricky}` } },
        { type: 'tool-edit', toolCallId: 'tb', state: 'output-available', input: { path: 'a "q".txt' }, output: tricky },
        { type: 'file', mediaType: 'image/png', url: dataUrl },
        statusPart({ runId: 'run-b', name: 'child-b', status: 'done', startedAt: 1, endedAt: 2, finalOutput: 'x'.repeat(pad) }),
        { type: 'text', text: `answer ${tricky} ${FILLER}`, state: 'done' },
      ] as UIMessage['parts'],
    })
    const carrierLen = (f: ReturnType<typeof assistantRecordFields>) => JSON.stringify(f.metadata.uiParts).length

    it('exactly at the limit nothing is shed; one char over sheds only the optional status text', () => {
      const probe = assistantRecordFields(build(10000, 'bp'), {}, { stopped: false })
      expect(probe.metadata).not.toHaveProperty('uiPartsSkipped')
      expect(probe.metadata).not.toHaveProperty('uiTaskStatusShed')
      const stored = (probe.metadata.uiParts as { parts: Record<string, unknown>[] }).parts
      // Pointer forms: the tool output and media payload live in content, not the carrier.
      expect(stored.find(p => p.type === 'tool-edit')).toMatchObject({ outputInContent: true })
      expect(stored.find(p => p.type === 'tool-edit')).not.toHaveProperty('output')
      expect(stored.find(p => p.type === 'file')).toHaveProperty('contentRef')
      expect(stored.find(p => p.type === 'file')).not.toHaveProperty('url')
      const exactPad = 10000 + (LIMIT - carrierLen(probe))
      expect(exactPad).toBeLessThanOrEqual(TASK_STATUS_TEXT_LIMIT)

      const atMsg = build(exactPad, 'b-at')
      const at = assistantRecordFields(atMsg, {}, { stopped: false })
      expect(carrierLen(at)).toBe(LIMIT)
      expect(at.metadata).not.toHaveProperty('uiPartsSkipped')
      expect(at.metadata).not.toHaveProperty('uiTaskStatusShed')

      const over = build(exactPad + 1, 'b-over')
      const shedFields = assistantRecordFields(over, {}, { stopped: false })
      expect(shedFields.metadata).not.toHaveProperty('uiPartsSkipped')
      expect(shedFields.metadata.uiTaskStatusShed).toEqual({ truncated: 1 })
      expect(carrierLen(shedFields)).toBeLessThanOrEqual(LIMIT)

      for (const [message, fields] of [[atMsg, at], [over, shedFields]] as const) {
        const reloaded = convertThreadMessageToUIMessage(store(message, fields))
        expect(canonical(reloaded)).toEqual(canonical(message))
        const rows = taskStatusRows([reloaded])
        expect(rows.map(r => [r.runId, r.name, r.status, r.startedAt, r.endedAt])).toEqual([['run-b', 'child-b', 'done', 1, 2]])
      }
    })

    it('over budget with several optional statuses: canonical/context parts survive and nothing is skipped', async () => {
      const base = build(10, 'bs').parts.filter(p => p.type !== TASK_STATUS_PART)
      const message: UIMessage = {
        id: 'bs', role: 'assistant',
        parts: [...base.slice(0, 4), ...[0, 1, 2].map(i => statusPart(row(i))), ...base.slice(4)],
      }
      const fields = assistantRecordFields(message, {}, { stopped: false })
      expect(fields.metadata).not.toHaveProperty('uiPartsSkipped')
      expect(fields.metadata.uiTaskStatusShed).toMatchObject({ truncated: expect.any(Number) })
      expect(carrierLen(fields)).toBeLessThanOrEqual(LIMIT)
      const reloaded = convertThreadMessageToUIMessage(store(message, fields))
      expect(canonical(reloaded)).toEqual(canonical(message))
      expect(taskStatusRows([reloaded]).map(r => r.runId)).toEqual(['run-0', 'run-1', 'run-2'])
      const model = JSON.stringify(await convertToModelMessages(expandChatRunContext([user, reloaded])))
      expect(model).not.toContain('task-status')
    })
  })

  describe('shapeTaskStatusPart bounds (enum, row count, id and text limits)', () => {
    const good = (over: Record<string, unknown> = {}) => ({ runId: 'r', name: 'n', status: 'done', startedAt: 1, ...over })
    const part = (rows: unknown[]) => ({ type: TASK_STATUS_PART, id: 'task-status:r', data: { subagents: rows } })
    it('accepts the boundary values', () => {
      for (const status of ['running', 'done', 'error']) expect(shapeTaskStatusPart(part([good({ status })]))).toBeDefined()
      expect(shapeTaskStatusPart(part(Array.from({ length: TASK_STATUS_MAX_ROWS_PER_PART }, () => good())))).toBeDefined()
      expect(shapeTaskStatusPart(part([good({ runId: 'r'.repeat(TASK_STATUS_MAX_ID_CHARS), name: 'n'.repeat(TASK_STATUS_MAX_ID_CHARS) })]))).toBeDefined()
    })
    it('rejects every malformed shape', () => {
      const bad: [string, unknown][] = [
        ['unknown status', part([good({ status: 'queued' })])],
        ['missing status', part([good({ status: undefined })])],
        ['zero rows', part([])],
        ['too many rows', part(Array.from({ length: TASK_STATUS_MAX_ROWS_PER_PART + 1 }, () => good()))],
        ['non-array rows', { type: TASK_STATUS_PART, id: 'x', data: { subagents: {} } }],
        ['empty runId', part([good({ runId: '' })])],
        ['long runId', part([good({ runId: 'r'.repeat(TASK_STATUS_MAX_ID_CHARS + 1) })])],
        ['empty name', part([good({ name: '' })])],
        ['long name', part([good({ name: 'n'.repeat(TASK_STATUS_MAX_ID_CHARS + 1) })])],
        ['non-finite startedAt', part([good({ startedAt: Infinity })])],
        ['string endedAt', part([good({ endedAt: '1' })])],
        ['non-string finalOutput', part([good({ finalOutput: 1 })])],
        ['non-string error', part([good({ error: {} })])],
        ['extra row key', part([good({ extra: 1 })])],
        ['array row', part([[]])],
        ['null row', part([null])],
        ['extra data key', { type: TASK_STATUS_PART, id: 'x', data: { subagents: [good()], other: 1 } }],
        ['extra part key', { ...part([good()]), extra: 1 }],
        ['empty id', { ...part([good()]), id: '' }],
        ['no data', { type: TASK_STATUS_PART, id: 'x' }],
        ['one bad row among good', part([good(), good({ status: 'nope' })])],
      ]
      for (const [label, p] of bad) expect(shapeTaskStatusPart(p), label).toBeUndefined()
    })
    it('bounds live text with the marker and keeps text within the limit unchanged', () => {
      const shaped = shapeTaskStatusPart(part([good({ finalOutput: 'x'.repeat(TASK_STATUS_TEXT_LIMIT + 5), error: 'ok' })])) as { data: { subagents: { finalOutput: string; error: string }[] } }
      expect(shaped.data.subagents[0].finalOutput).toHaveLength(TASK_STATUS_TEXT_LIMIT)
      expect(shaped.data.subagents[0].finalOutput.endsWith(TASK_STATUS_TRUNCATION_MARKER)).toBe(true)
      expect(shaped.data.subagents[0].error).toBe('ok')
    })
  })

  describe('rehydrate tolerates malformed stored status parts (read side)', () => {
    const base = () => {
      const parts = [
        { type: 'reasoning', text: 'thinking', state: 'done', providerMetadata: { anthropic: { signature: 'sig-r' } } },
        { type: 'tool-edit', toolCallId: 'tc1', state: 'output-available', input: { path: 'a.txt' }, output: 'Edited' },
        { type: RUN_CONTEXT_PART, data: { text: 'ctx-read-marker' } },
        statusPart(row(0, { finalOutput: 'ok' })),
        { type: 'text', text: 'final', state: 'done' },
      ] as UIMessage['parts']
      const message: UIMessage = { id: 'rd', role: 'assistant', parts }
      const fields = assistantRecordFields(message, {}, { stopped: false })
      expect(fields.metadata).not.toHaveProperty('uiPartsSkipped')
      return { parts, stored: store(message, fields) }
    }
    const inject = (stored: ThreadMessage, extra: unknown[]): ThreadMessage => {
      const copy = JSON.parse(JSON.stringify(stored)) as ThreadMessage
      const carrier = (copy.metadata as { uiParts: { parts: unknown[] } }).uiParts
      carrier.parts.splice(3, 0, ...extra)
      return copy
    }
    const malformed = [
      { type: TASK_STATUS_PART, id: 'task-status:x1', data: { subagents: [{ runId: 'x1', name: 'n', status: 'bogus', startedAt: 1 }] } },
      { type: TASK_STATUS_PART, id: 'task-status:x2', data: { subagents: [] } },
      { type: TASK_STATUS_PART, id: 'task-status:x3', data: { subagents: Array.from({ length: TASK_STATUS_MAX_ROWS_PER_PART + 1 }, (_, i) => ({ runId: `x${i}`, name: 'n', status: 'done', startedAt: 1 })) } },
      { type: TASK_STATUS_PART, id: 'task-status:x4', data: { subagents: [{ runId: 'r'.repeat(TASK_STATUS_MAX_ID_CHARS + 1), name: 'n', status: 'done', startedAt: 1 }] } },
      { type: TASK_STATUS_PART, id: 'task-status:x5', data: { subagents: [{ runId: 'x5', name: 'n', status: 'done', startedAt: 1, extra: true }] } },
      { type: TASK_STATUS_PART, id: 'task-status:x6', data: 'junk' },
    ]

    it('one bad status part keeps the valid siblings, run-context and model context; only the bad part is omitted and noticed', async () => {
      const { parts, stored } = base()
      for (const bad of malformed) {
        const reloaded = convertThreadMessageToUIMessage(inject(stored, [bad]))
        expect(reloaded.parts.find(p => p.type === 'reasoning')).toMatchObject({ providerMetadata: { anthropic: { signature: 'sig-r' } } })
        expect(reloaded.parts.find(p => p.type === 'tool-edit')).toMatchObject({ toolCallId: 'tc1', output: 'Edited' })
        expect(reloaded.parts.filter(p => p.type === RUN_CONTEXT_PART)).toEqual(parts.filter(p => p.type === RUN_CONTEXT_PART))
        expect(taskStatusRows([reloaded]).map(r => r.runId)).toEqual(['run-0'])
        expect(JSON.stringify(reloaded.parts)).not.toContain('task-status:x')
        expect((reloaded.metadata as Record<string, unknown>).uiTaskStatusShed).toEqual({ dropped: 1 })
        expect(reloaded.metadata).not.toHaveProperty('uiPartsSkipped')
        const model = JSON.stringify(await convertToModelMessages(expandChatRunContext([user, reloaded])))
        expect(model.split('ctx-read-marker').length - 1).toBe(1)
        expect(model).not.toContain('task-status')
      }
    })

    it('several bad status parts are counted, added to the writer\'s own count, and never written back', () => {
      const { stored } = base()
      const withShed = { ...stored, metadata: { ...stored.metadata, uiTaskStatusShed: { truncated: 2, dropped: 1 } } } as ThreadMessage
      const reloaded = convertThreadMessageToUIMessage(inject(withShed, malformed))
      expect((reloaded.metadata as Record<string, unknown>).uiTaskStatusShed).toEqual({ truncated: 2, dropped: 1 + malformed.length })
      expect(taskStatusRows([reloaded]).map(r => r.runId)).toEqual(['run-0'])
      expect(withShed.metadata).toMatchObject({ uiTaskStatusShed: { truncated: 2, dropped: 1 } })
    })

    it('a status part with a stray contentRef (missing or out of range) is dropped and counted; valid siblings survive', () => {
      const { parts, stored } = base()
      const strays = [
        { type: TASK_STATUS_PART, id: 'task-status:s1', contentRef: 99, data: { subagents: [{ runId: 's1', name: 'n', status: 'done', startedAt: 1 }] } },
        { type: TASK_STATUS_PART, id: 'task-status:s2', contentRef: 0, data: { subagents: [{ runId: 's2', name: 'n', status: 'done', startedAt: 1 }] } },
        { type: TASK_STATUS_PART, id: 'task-status:s3', contentRef: -1, mediaType: 'image/png', data: { subagents: [{ runId: 's3', name: 'n', status: 'done', startedAt: 1 }] } },
      ]
      for (const stray of strays) {
        const reloaded = convertThreadMessageToUIMessage(inject(stored, [stray]))
        expect(reloaded.metadata).not.toHaveProperty('uiPartsSkipped')
        expect(reloaded.parts.find(p => p.type === 'reasoning')).toMatchObject({ providerMetadata: { anthropic: { signature: 'sig-r' } } })
        expect(reloaded.parts.find(p => p.type === 'tool-edit')).toMatchObject({ toolCallId: 'tc1', output: 'Edited' })
        expect(reloaded.parts.filter(p => p.type === RUN_CONTEXT_PART)).toEqual(parts.filter(p => p.type === RUN_CONTEXT_PART))
        expect(taskStatusRows([reloaded]).map(r => r.runId)).toEqual(['run-0'])
        expect((reloaded.metadata as Record<string, unknown>).uiTaskStatusShed).toEqual({ dropped: 1 })
      }
    })

    it('a status part with outputInContent: true is dropped and counted; valid siblings survive', () => {
      const { stored } = base()
      const data = { subagents: [{ runId: 'o1', name: 'n', status: 'done', startedAt: 1 }] }
      // One pointing at a real tool output, one at a call that is not in content.
      for (const toolCallId of ['tc1', 'no-such-call', undefined]) {
        const stray = { type: TASK_STATUS_PART, id: 'task-status:o1', outputInContent: true, toolCallId, data }
        const reloaded = convertThreadMessageToUIMessage(inject(stored, [stray]))
        expect(reloaded.metadata).not.toHaveProperty('uiPartsSkipped')
        expect(reloaded.parts.find(p => p.type === 'tool-edit')).toMatchObject({ toolCallId: 'tc1', output: 'Edited' })
        expect(JSON.stringify(reloaded.parts)).not.toContain('task-status:o1')
        expect(taskStatusRows([reloaded]).map(r => r.runId)).toEqual(['run-0'])
        expect((reloaded.metadata as Record<string, unknown>).uiTaskStatusShed).toEqual({ dropped: 1 })
      }
    })

    it('a stray pointer on a NON-status part still fails closed to content only', () => {
      const { stored } = base()
      const bad = { type: 'text', text: 'x', state: 'done', contentRef: 99 }
      const reloaded = convertThreadMessageToUIMessage(inject(stored, [bad]))
      expect(JSON.stringify(reloaded.parts)).not.toContain('sig-r')
      expect(taskStatusRows([reloaded])).toEqual([])
    })

    it('a prior uiTaskStatusShed that is a string, array or null is ignored; valid counts are kept; bad fields are left out', () => {
      const { stored } = base()
      const bad = [{ type: TASK_STATUS_PART, id: 'task-status:p1', data: { subagents: [] } }]
      const withPrior = (prior: unknown) => ({ ...stored, metadata: { ...stored.metadata, uiTaskStatusShed: prior } }) as ThreadMessage
      const shed = (prior: unknown) => (convertThreadMessageToUIMessage(inject(withPrior(prior), bad)).metadata as Record<string, unknown>).uiTaskStatusShed
      for (const prior of ['oops', ['a', 'b'], [1, 2], null, 7, true]) {
        const out = shed(prior)
        expect(out).toEqual({ dropped: 1 })
        expect(Array.isArray(out)).toBe(false)
      }
      expect(shed({ truncated: 2, stripped: 3, dropped: 4 })).toEqual({ truncated: 2, stripped: 3, dropped: 5 })
      expect(shed({ truncated: -1, stripped: 1.5, dropped: Infinity })).toEqual({ dropped: 1 })
      expect(shed({ truncated: '2', stripped: NaN, dropped: -3 })).toEqual({ dropped: 1 })
      expect(shed({ truncated: 0, other: 'x' })).toEqual({ truncated: 0, dropped: 1 })
    })

    it('a clean carrier reloads with no new notice', () => {
      const { stored } = base()
      expect(convertThreadMessageToUIMessage(stored).metadata).not.toHaveProperty('uiTaskStatusShed')
    })

    it('a bad NON-status part still fails closed to content only', () => {
      const { stored } = base()
      for (const bad of [
        { type: RUN_CONTEXT_PART, data: { text: 'a', other: 1 } },
        { type: 'data-unknown-thing', data: 1 },
        { type: 'text', text: 5 },
      ]) {
        const reloaded = convertThreadMessageToUIMessage(inject(stored, [malformed[0], bad]))
        expect(reloaded.parts.some(p => p.type === RUN_CONTEXT_PART)).toBe(false)
        expect(JSON.stringify(reloaded.parts)).not.toContain('sig-r')
        expect(taskStatusRows([reloaded])).toEqual([])
      }
    })

    it('a carrier whose canonical content no longer matches still fails closed (status filtering grants no authority)', () => {
      const { stored } = base()
      const changed = inject({ ...stored, content: [{ type: 'text', text: { value: 'edited elsewhere', annotations: [] } }] } as unknown as ThreadMessage, [malformed[0]])
      const reloaded = convertThreadMessageToUIMessage(changed)
      expect(JSON.stringify(reloaded.parts)).not.toContain('sig-r')
      expect(reloaded.parts.some(p => p.type === RUN_CONTEXT_PART)).toBe(false)
    })
  })

  it('drops only a malformed stored display status while keeping valid context and reasoning', () => {
    const message = { id: 'stored-invalid', role: 'assistant', parts: [
      { type: 'reasoning', text: 'r', state: 'done', providerMetadata: { anthropic: { signature: 'sig' } } },
      { type: RUN_CONTEXT_PART, data: { text: 'keep-context' } },
      { type: 'text', text: 'answer', state: 'done' },
    ] } as UIMessage
    const fields = assistantRecordFields(message, {}, {})
    const record = store(message, fields)
    ;(record.metadata!.uiParts as { parts: unknown[] }).parts.push({ type: TASK_STATUS_PART, id: 'bad', data: { subagents: [{ runId: 'bad', status: 'invalid' }] } })
    const loaded = convertThreadMessageToUIMessage(record)
    expect(loaded.parts).toEqual(message.parts)
    expect(loaded.metadata?.uiTaskStatusShed).toEqual({ dropped: 1 })
    ;(record.metadata!.uiParts as { parts: unknown[] }).parts.push({ type: 'unknown-canonical-part' })
    expect(convertThreadMessageToUIMessage(record).parts.some(p => p.type === RUN_CONTEXT_PART)).toBe(false)
  })

  it('a rebuild clears stale shed metadata, and so does an edited branch', () => {
    const parts = [
      { type: 'reasoning', text: 't', state: 'done', providerMetadata: { anthropic: { signature: 's' } } },
      statusPart(row(0)), statusPart(row(1)), statusPart(row(2)),
    ] as UIMessage['parts']
    const first = assistantRecordFields({ id: 'm4', role: 'assistant', parts }, {}, { stopped: false })
    expect(first.metadata.uiTaskStatusShed).toBeDefined()
    const small = assistantRecordFields({ id: 'm4', role: 'assistant', parts: [{ type: 'text', text: 'hi', state: 'done' }] }, first.metadata, { stopped: false })
    // A small turn may rebuild a valid carrier: assert it is fresh (no stale shed
    // metadata, text from the new parts, nothing from the old status parts).
    for (const key of ['uiPartsSkipped', 'uiDiffsOmitted', 'uiTaskStatusShed']) expect(small.metadata).not.toHaveProperty(key)
    expect(small.metadata.uiParts).toEqual({ v: 1, parts: [{ type: 'text', text: 'hi', state: 'done' }] })
    expect(JSON.stringify(small.metadata)).not.toContain('task-status')
    const source = { ...store({ id: 'm4', role: 'assistant', parts }, first), created_at: 1 } as ThreadMessage
    const edited = makeSibling(source, { id: 'b', createdAt: 2, text: 'edited' })
    expect(edited.metadata).not.toHaveProperty('uiTaskStatusShed')
    expect(edited.metadata).not.toHaveProperty('uiParts')
  })
})
