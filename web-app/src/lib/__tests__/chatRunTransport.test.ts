import { isChatRunNotice, withoutChatRunNotices } from '../chatRunNotice'
import type { ThreadMessage } from '@janhq/core'
import { assistantRecordFields, convertThreadMessageToUIMessage } from '../messages'
import { describe, it, expect, vi } from 'vitest'
import { convertToModelMessages, readUIMessageStream, type UIMessageChunk, type UIMessage } from 'ai'
import { canContinueStoppedTurn, createChatRunStream } from '../chatRunTransport'

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
  it('gates Continue like the route: capped turns resume from tool history, stopped turns need partial text', () => {
    const notice = { type: 'text' as const, text: 'Stopped at the step limit.', providerMetadata: { jan: { chatRunNotice: true } } }
    const tool = { type: 'tool-fixture', toolCallId: 'c', state: 'output-available', input: {}, output: 'done' } as unknown as UIMessage['parts'][number]
    const text = { type: 'text' as const, text: 'partial' }
    const capped = { stopped: true, runStopReason: 'steps' }
    // Capped tool-only turns must offer Continue — the working path resumes
    // them from kept history. The notice alone never qualifies.
    expect(canContinueStoppedTurn(capped, [tool, notice])).toBe(true)
    expect(canContinueStoppedTurn(capped, [notice])).toBe(false)
    expect(canContinueStoppedTurn({ stopped: true, runStopReason: 'tokens' }, [tool, notice])).toBe(true)
    // User-stopped turns keep the old rule: only partial text/reasoning resumes.
    expect(canContinueStoppedTurn({ stopped: true }, [tool])).toBe(false)
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
  it('normalizes a dispatch exception without a second dispatch', async () => {
    const send = vi.fn().mockResolvedValueOnce(stream([{ type: 'tool-input-available', toolCallId: 'c', toolName: 'fixture', input: {} }, { type: 'finish' }])).mockResolvedValueOnce(stream(answer))
    const dispatch = vi.fn().mockRejectedValue(new Error('fixture denied'))
    const message = await consume(createChatRunStream({ messages: [user], messageId: 'a', signal: new AbortController().signal, sendStep: send, dispatch }))
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(message.parts.find(p => 'toolCallId' in p)).toMatchObject({ state: 'output-error', errorText: 'fixture denied' })
  })
})
