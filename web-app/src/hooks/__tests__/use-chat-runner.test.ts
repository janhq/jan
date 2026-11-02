import { beforeEach, describe, expect, it, vi } from 'vitest'
import React, { useState } from 'react'
import { act, render, screen, fireEvent, renderHook, waitFor } from '@testing-library/react'
import type { UIMessageChunk } from 'ai'

const h = vi.hoisted(() => ({ send: vi.fn(), begin: vi.fn(), release: vi.fn() }))
vi.mock('@/lib/custom-chat-transport', async () => {
  const actual = await vi.importActual<typeof import('@/lib/custom-chat-transport')>('@/lib/custom-chat-transport')
  return {
  CustomChatTransport: class extends actual.CustomChatTransport {
    abort?: () => void
    done: Promise<void> = Promise.resolve()
    beginChatRun(abort: () => void) {
      this.abort = abort
      h.begin()
      let finish!: () => void
      this.done = new Promise(resolve => { finish = resolve })
      return () => { h.release(); this.abort = undefined; finish() }
    }
    async cancelChatRun() { this.abort?.(); await this.done; await super.cancelChatRun() }
    getTurnModelSelection() { return { selectedModel: { settings: { ctx_len: { controller_props: { value: 1000000 } } } } } }
    sendMessages = h.send
    reconnectToStream = async () => null
    updateSystemMessage() {}
    setOnTokenUsage() {}
    refreshTools() {}
  },
  }
})
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
    await waitFor(() => expect(result.current.status).toBe('ready'))
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
    await waitFor(() => expect(h.release).toHaveBeenCalledTimes(1))
    expect(result.current.status).toBe('ready')
    h.send.mockResolvedValueOnce(answer())
    await act(async () => { await result.current.sendMessage({ text: 'next accepted' }) })
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(h.begin).toHaveBeenCalledTimes(2)
  })
  it('reserves same-tick text admission before SDK conversion yields', async () => {
    h.send.mockResolvedValue(wave())
    const dispatch = vi.fn().mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useChat({ sessionId: 'fixture', dispatchTool: dispatch }))
    let accepted!: Promise<void>
    let rejected!: Promise<void>
    let regeneration!: Promise<void>
    act(() => {
      accepted = result.current.sendMessage({ text: 'first owns admission' })
      rejected = result.current.sendMessage({ text: 'second must not mutate' })
      regeneration = result.current.regenerate()
    })
    await expect(rejected).rejects.toThrow('already running')
    await expect(regeneration).rejects.toThrow('Stop the current')
    await act(async () => { await accepted })
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    expect(result.current.messages.filter(m => m.role === 'user')).toHaveLength(1)
    expect(result.current.messages[0].parts).toEqual([{ type: 'text', text: 'first owns admission' }])
    expect(h.send).toHaveBeenCalledTimes(1)
    await act(async () => { await result.current.stop() })
    await waitFor(() => expect(h.release).toHaveBeenCalledTimes(1))
    expect(result.current.status).toBe('ready')
  })
  it('does not reject accepted admission when the later model send fails', async () => {
    h.send.mockRejectedValueOnce(new Error('fixture provider failure'))
    const onError = vi.fn()
    const { result } = renderHook(() => useChat({ sessionId: 'fixture', dispatchTool: vi.fn(), onError }))
    await act(async () => { await expect(result.current.sendMessage({ text: 'accepted user' })).resolves.toBeUndefined() })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.messages.filter(m => m.role === 'user')).toHaveLength(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(h.release).toHaveBeenCalledTimes(1)
  })
  it('cancel barrier permits an immediate real SDK replacement request', async () => {
    h.send.mockResolvedValueOnce(wave()).mockResolvedValueOnce(answer())
    const dispatch = vi.fn().mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useChat({ sessionId: 'fixture', dispatchTool: dispatch }))
    await act(async () => { await result.current.sendMessage({ text: 'original' }) })
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    const session = useChatSessions.getState().sessions.fixture
    await act(async () => {
      await session.transport.cancelChatRun()
      await result.current.regenerate()
    })
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('ready')
    expect(result.current.messages.at(-1)?.parts).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'done' })]))
  })
  it('acknowledges enqueue before a held tool finishes so later composer text survives', async () => {
    h.send.mockResolvedValueOnce(wave()).mockResolvedValueOnce(answer())
    let finish!: (v: { output: string }) => void
    const dispatch = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
    function Composer() {
      const chat = useChat({ sessionId: 'fixture', dispatchTool: dispatch })
      const [draft, setDraft] = useState('original draft')
      return React.createElement('div', {},
        React.createElement('input', { 'aria-label': 'draft', value: draft, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value) }),
        React.createElement('button', { onClick: async () => { await chat.sendMessage({ text: draft }); setDraft('') } }, 'Submit'),
        React.createElement('span', { 'data-testid': 'status' }, chat.status))
    }
    render(React.createElement(Composer))
    await act(async () => { fireEvent.click(screen.getByText('Submit')) })
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('draft')).toHaveValue('')
    expect(screen.getByTestId('status')).toHaveTextContent('streaming')
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'typed during held tool' } })
    await act(async () => { finish({ output: 'done' }) })
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
    expect(screen.getByLabelText('draft')).toHaveValue('typed during held tool')
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
    await waitFor(() => expect(h.release).toHaveBeenCalledTimes(1))
  })
})
