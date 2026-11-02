import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { UIMessageChunk } from 'ai'

const h = vi.hoisted(() => ({ send: vi.fn(), begin: vi.fn(), release: vi.fn() }))
vi.mock('@/lib/custom-chat-transport', () => ({
  CustomChatTransport: class {
    abort?: () => void
    done: Promise<void> = Promise.resolve()
    beginChatRun(abort: () => void) {
      this.abort = abort
      h.begin()
      let finish!: () => void
      this.done = new Promise(resolve => { finish = resolve })
      return () => { h.release(); this.abort = undefined; finish() }
    }
    async cancelChatRun() { this.abort?.(); await this.done }
    sendMessages = h.send
    reconnectToStream = async () => null
    updateSystemMessage() {}
    setOnTokenUsage() {}
    refreshTools() {}
  },
}))
vi.mock('@/hooks/useAppState', () => ({ useAppState: (select: (state: unknown) => unknown) => select({ mcpToolNames: new Set(), ragToolNames: new Set() }) }))
import { useChat } from '../use-chat'
import { useChatSessions } from '@/stores/chat-session-store'

const wave = () => new ReadableStream<UIMessageChunk>({ start(c) {
  c.enqueue({ type: 'tool-input-available', toolCallId: 'fixture', toolName: 'fixture', input: {} })
  c.enqueue({ type: 'finish' }); c.close()
} })
const answer = () => new ReadableStream<UIMessageChunk>({ start(c) {
  c.enqueue({ type: 'text-start', id: 'text' }); c.enqueue({ type: 'text-delta', id: 'text', delta: 'done' }); c.enqueue({ type: 'text-end', id: 'text' }); c.enqueue({ type: 'finish' }); c.close()
} })
describe('production useChat wrapper with real SDK Chat and runTurn', () => {
  beforeEach(() => { useChatSessions.getState().clearSessions(); vi.clearAllMocks(); h.send.mockReset() })
  it('keeps SDK streaming busy through dispatch then sends exactly one follow-up (no auto-submit)', async () => {
    h.send.mockResolvedValueOnce(wave()).mockResolvedValueOnce(answer())
    let finish!: (v: { output: unknown }) => void
    const dispatch = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const { result } = renderHook(() => useChat({ sessionId: 'fixture', dispatchTool: dispatch }))
    let sent!: Promise<void>
    act(() => { sent = result.current.sendMessage({ text: 'fixture' }) })
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    expect(result.current.status).toBe('streaming')
    expect(useChatSessions.getState().sessions.fixture.isStreaming).toBe(true)
    await act(async () => { finish({ output: { typed: false } }); await sent })
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(h.begin).toHaveBeenCalledTimes(1)
    expect(h.release).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('ready')
    expect(result.current.messages.at(-1)?.parts.find(p => 'toolCallId' in p)).toMatchObject({ output: { typed: false }, state: 'output-available' })
  })
  it('rejects overlapping send/regenerate before SDK mutation and Stop still owns the original run', async () => {
    h.send.mockResolvedValue(wave())
    const dispatch = vi.fn().mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useChat({ sessionId: 'fixture', dispatchTool: dispatch }))
    let sent!: Promise<void>
    act(() => { sent = result.current.sendMessage({ text: 'original' }) })
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    const original = result.current.messages
    await expect(result.current.sendMessage({ text: 'must not append' })).rejects.toThrow('already running')
    await expect(result.current.regenerate()).rejects.toThrow('Stop the current')
    expect(result.current.messages).toEqual(original)
    expect(result.current.status).toBe('streaming')
    await act(async () => { await result.current.stop(); await sent })
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.release).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('ready')
    h.send.mockResolvedValueOnce(answer())
    await act(async () => { await result.current.sendMessage({ text: 'next accepted' }) })
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(h.begin).toHaveBeenCalledTimes(2)
  })
  it('deleting the retained session alone aborts a hung dispatch and prevents follow-up', async () => {
    h.send.mockResolvedValue(wave())
    const dispatch = vi.fn().mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useChat({ sessionId: 'fixture', dispatchTool: dispatch }))
    let sent!: Promise<void>
    act(() => { sent = result.current.sendMessage({ text: 'fixture' }) })
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    await act(async () => { useChatSessions.getState().removeSession('fixture'); await sent })
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.release).toHaveBeenCalledTimes(1)
  })
})
