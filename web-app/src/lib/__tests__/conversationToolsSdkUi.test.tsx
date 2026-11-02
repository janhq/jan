import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { convertToModelMessages, jsonSchema, streamText, tool, type UIMessage } from 'ai'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { CoworkAskCard } from '@/containers/CoworkAskCard'
import { createConversationToolHandlers } from '../conversationToolHandlers'
import { dispatchClientTool } from '../clientToolDispatch'
import { runTurn } from '../coworkRunner'
import { conversationTodos } from '../conversationTaskPresentation'
import type { AskAnswer, AskRequestPayload, TodoList } from '@/types/coworkSession'

// Deliberately synthetic provider boundary; real AI SDK streaming/conversion,
// runner, client handlers and mounted ask UI. No transport, native app or network.
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const question = { questions: [{ id: 'q', question: 'Choose synthetic scope', options: [{ label: 'Small' }, { label: 'Large' }] }] }
const todo = { op: 'init', items: ['Synthetic task'] }
const usage = { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } }
const modelStep = (parts: LanguageModelV3StreamPart[], tools = false) => ({
  stream: simulateReadableStream({ chunks: [
    { type: 'stream-start', warnings: [] }, ...parts,
    { type: 'finish', finishReason: { unified: tools ? 'tool-calls' : 'stop', raw: undefined }, usage },
  ] as LanguageModelV3StreamPart[] }),
})

function fixture() {
  let updateAsk: (value: { id: string, request: AskRequestPayload } | null) => void = () => {}
  let updateTodo: (value: TodoList) => void = () => {}
  const transcript: UIMessage[] = []
  const controller = new AbortController()
  const pendingAsks = new Map<string, (answers: AskAnswer[] | null) => void>()
  const onAnswer = vi.fn()
  const handlers = createConversationToolHandlers({
    signal: controller.signal, getTodo: () => conversationTodos(transcript),
    onTodo: (list, toolCallId) => {
      transcript.push({ id: toolCallId!, role: 'assistant', parts: [{ type: 'tool-todo', toolCallId: toolCallId!, state: 'output-available', input: {}, output: JSON.stringify(list) }] })
      updateTodo(list)
    },
    pendingAsks,
    showAsk: (id, request) => updateAsk({ id, request }),
    hideAsk: () => updateAsk(null), onAnswer,
  })
  function Harness() {
    const [ask, setAsk] = useState<{ id: string, request: AskRequestPayload } | null>(null)
    const [list, setList] = useState<TodoList>()
    updateAsk = setAsk
    updateTodo = setList
    return <><div data-testid="tasks">{list?.phases.flatMap((p) => p.tasks.map((t) => t.content)).join(', ')}</div><CoworkAskCard requestId={ask?.id ?? null} request={ask?.request ?? null} onRespond={(id, answers) => pendingAsks.get(id)?.(answers)} /></>
  }
  return { Harness, controller, pendingAsks, handlers, onAnswer, transcript }
}

describe('isolated synthetic UI with the installed real AI SDK', () => {
  it('streams todo/ask through the runner, pauses for a real card answer, and resumes with tool results', async () => {
    const f = fixture()
    render(<f.Harness />)
    const steps = [
      modelStep([
        { type: 'tool-call', toolCallId: 'todo-1', toolName: 'todo', input: JSON.stringify(todo) },
        { type: 'tool-call', toolCallId: 'todo-2', toolName: 'todo', input: JSON.stringify({ op: 'append', items: ['Second task'] }) },
      ], true),
      modelStep([{ type: 'tool-call', toolCallId: 'ask-1', toolName: 'ask', input: JSON.stringify(question) }], true),
      modelStep([{ type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'Synthetic answer accepted' }, { type: 'text-end', id: 'text' }]),
    ]
    let step = 0
    const model = new MockLanguageModelV3({ doStream: async () => steps[step++] })
    const neverExecute = vi.fn(async () => ({ output: 'unexpected' }))
    const tools = {
      todo: tool({ inputSchema: jsonSchema({ type: 'object' }) }),
      ask: tool({ inputSchema: jsonSchema({ type: 'object' }) }),
    }
    let id = 0
    const pending = runTurn({
      signal: f.controller.signal,
      messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Run synthetic tools' }] }],
      deps: {
        sendStep: async (messages, signal) => streamText({ model, messages: await convertToModelMessages(messages), tools, abortSignal: signal, maxRetries: 0 }).toUIMessageStream(),
        dispatch: async (call) => (await dispatchClientTool(call, { ...f.handlers, onTask: neverExecute, onMonitor: neverExecute }))!,
        sink: { onText: vi.fn(), onReasoning: vi.fn(), onToolStart: vi.fn(), onToolArgsDelta: vi.fn(), onToolCall: vi.fn() },
        onStep: vi.fn(), nextMessageId: () => `assistant-${++id}`,
      },
    })
    await screen.findByText('Choose synthetic scope')
    expect(screen.getByTestId('tasks')).toHaveTextContent('Synthetic task, Second task')
    expect(conversationTodos(f.transcript)?.phases[0].tasks.map((task) => task.content)).toEqual(['Synthetic task', 'Second task'])
    expect(model.doStreamCalls).toHaveLength(2)
    expect(f.pendingAsks.size).toBe(1)
    fireEvent.click(screen.getByText('Small'))
    fireEvent.click(screen.getByLabelText('common:submit'))
    let result!: Awaited<typeof pending>
    await act(async () => { result = await pending })
    expect(result.stoppedBy).toBe('done')
    expect(model.doStreamCalls).toHaveLength(3)
    expect(JSON.stringify(model.doStreamCalls[2].prompt)).toContain('Small')
    expect(JSON.stringify(result.messages)).toContain('Synthetic answer accepted')
    expect(conversationTodos(JSON.parse(JSON.stringify(result.messages)))?.phases[0].tasks.map((task) => task.content)).toEqual(['Synthetic task', 'Second task'])
    expect(f.onAnswer).toHaveBeenCalledOnce()
    expect(f.pendingAsks.size).toBe(0)
    expect(neverExecute).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Choose synthetic scope')).not.toBeInTheDocument())
  })

  it('rejects provider-reused settled ids across SDK steps without replaying todo or an old ask answer', async () => {
    const f = fixture()
    render(<f.Harness />)
    const laterQuestion = {
      questions: [{ id: 'later', question: 'Choose later scope', options: [{ label: 'Fresh' }, { label: 'Other' }] }],
    }
    const changedTodo = { op: 'init', items: ['Must not replace the task'] }
    const steps = [
      modelStep([
        { type: 'tool-call', toolCallId: 'todo-reused', toolName: 'todo', input: JSON.stringify(todo) },
        { type: 'tool-call', toolCallId: 'ask-reused', toolName: 'ask', input: JSON.stringify(question) },
      ], true),
      modelStep([
        { type: 'tool-call', toolCallId: 'todo-reused', toolName: 'todo', input: JSON.stringify(changedTodo) },
        { type: 'tool-call', toolCallId: 'ask-reused', toolName: 'ask', input: JSON.stringify(laterQuestion) },
      ], true),
      modelStep([{ type: 'tool-call', toolCallId: 'ask-fresh', toolName: 'ask', input: JSON.stringify(laterQuestion) }], true),
      modelStep([{ type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'Fresh answer accepted' }, { type: 'text-end', id: 'text' }]),
    ]
    let step = 0
    const model = new MockLanguageModelV3({ doStream: async () => steps[step++] })
    const neverExecute = vi.fn(async () => ({ output: 'unexpected' }))
    const dispatch = vi.fn(async (call: Parameters<typeof dispatchClientTool>[0]) =>
      (await dispatchClientTool(call, { ...f.handlers, onTask: neverExecute, onMonitor: neverExecute }))!)
    let id = 0
    const pending = runTurn({
      signal: f.controller.signal,
      messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Exercise provider id reuse' }] }],
      deps: {
        sendStep: async (messages, signal) => streamText({
          model, messages: await convertToModelMessages(messages),
          tools: { todo: tool({ inputSchema: jsonSchema({ type: 'object' }) }), ask: tool({ inputSchema: jsonSchema({ type: 'object' }) }) },
          abortSignal: signal, maxRetries: 0,
        }).toUIMessageStream(),
        dispatch,
        sink: { onText: vi.fn(), onReasoning: vi.fn(), onToolStart: vi.fn(), onToolArgsDelta: vi.fn(), onToolCall: vi.fn() },
        onStep: vi.fn(), nextMessageId: () => `reuse-assistant-${++id}`,
      },
    })
    await screen.findByText('Choose synthetic scope')
    const stale = f.pendingAsks.get('ask-reused')!
    fireEvent.click(screen.getByText('Small'))
    fireEvent.click(screen.getByLabelText('common:submit'))
    await screen.findByText('Choose later scope')
    expect(model.doStreamCalls).toHaveLength(3)
    expect(f.pendingAsks.has('ask-reused')).toBe(false)
    expect(f.pendingAsks.has('ask-fresh')).toBe(true)
    expect(f.onAnswer).toHaveBeenCalledTimes(1)
    expect(f.transcript).toHaveLength(1)
    expect(screen.getByTestId('tasks')).toHaveTextContent('Synthetic task')
    expect(screen.getByTestId('tasks')).not.toHaveTextContent('Must not replace')
    const repeatedResults = await Promise.all(dispatch.mock.results.slice(2, 4).map((entry) => entry.value))
    expect(repeatedResults).toEqual([
      { isError: true, output: expect.stringContaining('settled tool call id reused') },
      { isError: true, output: expect.stringContaining('settled tool call id reused') },
    ])
    expect(JSON.stringify(model.doStreamCalls[2].prompt)).toContain('settled tool call id reused')

    // Also exercise settled handler receipts directly: a runner-level duplicate
    // gate must never be the sole reason stale answers fail closed.
    expect(await f.handlers.onTodo(changedTodo, 'todo-reused')).toMatchObject({ isError: true })
    const reusedAsk = await f.handlers.onAsk('ask-reused', laterQuestion)
    expect(reusedAsk).toMatchObject({ isError: true, output: expect.stringContaining('settled tool call id reused') })
    expect(reusedAsk.output).not.toContain('Small')
    act(() => stale([{ id: 'q', selected: ['Small'] }]))
    expect(f.pendingAsks.has('ask-fresh')).toBe(true)
    expect(f.onAnswer).toHaveBeenCalledTimes(1)
    expect(model.doStreamCalls).toHaveLength(3)
    fireEvent.click(screen.getByText('Fresh'))
    fireEvent.click(screen.getByLabelText('common:submit'))
    let result!: Awaited<typeof pending>
    await act(async () => { result = await pending })
    expect(result.stoppedBy).toBe('done')
    expect(model.doStreamCalls).toHaveLength(4)
    expect(JSON.stringify(model.doStreamCalls[3].prompt)).toContain('Fresh')
    expect(f.onAnswer).toHaveBeenLastCalledWith(laterQuestion, [{ id: 'later', selected: ['Fresh'] }])
    expect(f.onAnswer).toHaveBeenCalledTimes(2)
    expect(f.pendingAsks.size).toBe(0)
    expect(f.transcript).toHaveLength(1)
    expect(neverExecute).not.toHaveBeenCalled()
  })

  it('preserves exact optional-null todo handler parity through two installed SDK steps', async () => {
    const f = fixture()
    render(<f.Harness />)
    const steps = [
      modelStep([{ type: 'tool-call', toolCallId: 'null-init', toolName: 'todo', input: JSON.stringify({
        op: 'init', list: [{ phase: null, items: ['x'] }, { phase: 'empty', items: null }], items: null,
      }) }], true),
      modelStep([{ type: 'tool-call', toolCallId: 'null-done', toolName: 'todo', input: JSON.stringify({ op: 'done', task: 'x', phase: null }) }], true),
      modelStep([]),
    ]
    let step = 0
    const model = new MockLanguageModelV3({ doStream: async () => steps[step++] })
    const neverExecute = vi.fn(async () => ({ output: 'unexpected' }))
    const dispatch = vi.fn(async (call: Parameters<typeof dispatchClientTool>[0]) =>
      (await dispatchClientTool(call, { ...f.handlers, onTask: neverExecute, onMonitor: neverExecute }))!)
    let id = 0
    let result!: Awaited<ReturnType<typeof runTurn>>
    await act(async () => {
      result = await runTurn({
        signal: f.controller.signal,
        messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Exercise null todo parity' }] }],
        deps: {
          sendStep: async (messages, signal) => streamText({ model, messages: await convertToModelMessages(messages), tools: { todo: tool({ inputSchema: jsonSchema({ type: 'object' }) }) }, abortSignal: signal, maxRetries: 0 }).toUIMessageStream(),
          dispatch,
          sink: { onText: vi.fn(), onReasoning: vi.fn(), onToolStart: vi.fn(), onToolArgsDelta: vi.fn(), onToolCall: vi.fn() },
          onStep: vi.fn(), nextMessageId: () => `null-assistant-${++id}`,
        },
      })
    })
    expect(result.stoppedBy).toBe('done')
    expect(model.doStreamCalls).toHaveLength(3)
    expect(dispatch).toHaveBeenCalledTimes(2)
    const outcomes = await Promise.all(dispatch.mock.results.map((entry) => entry.value))
    expect(outcomes.every((outcome) => !outcome.isError)).toBe(true)
    const expected = { phases: [
      { name: '', tasks: [{ content: 'x', status: 'completed' }] },
      { name: 'empty', tasks: [] },
    ] }
    expect(conversationTodos(f.transcript)).toEqual(expected)
    expect(conversationTodos(JSON.parse(JSON.stringify(result.messages)))).toEqual(expected)
    expect(screen.getByTestId('tasks')).toHaveTextContent('x')
    expect(neverExecute).not.toHaveBeenCalled()
  })

  it('removes a mounted suspended card on Stop and ignores stale UI answers', async () => {
    const f = fixture()
    render(<f.Harness />)
    let pending!: ReturnType<typeof f.handlers.onAsk>
    await act(async () => { pending = f.handlers.onAsk('ask-stop', question); await Promise.resolve() })
    expect(screen.getByText('Choose synthetic scope')).toBeInTheDocument()
    const stale = f.pendingAsks.get('ask-stop')!
    await act(async () => { f.controller.abort(); await pending })
    expect(await pending).toMatchObject({ isError: true })
    expect(screen.queryByText('Choose synthetic scope')).not.toBeInTheDocument()
    stale([{ id: 'q', selected: ['Small'] }])
    expect(f.onAnswer).not.toHaveBeenCalled()
    expect(f.pendingAsks.size).toBe(0)
  })
})
