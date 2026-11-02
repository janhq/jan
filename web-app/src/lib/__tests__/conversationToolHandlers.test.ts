import { describe, it, expect, vi } from 'vitest'
import {
  createConversationToolHandlers,
  type ConversationToolContext,
} from '../conversationToolHandlers'
import { dispatchClientTool } from '../clientToolDispatch'
import { conversationTodos } from '../conversationTaskPresentation'
import type { UIMessage } from 'ai'

const input = {
  questions: [
    { id: 'q', question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] },
  ],
}
const answers = [{ id: 'q', selected: ['A'] }]
function fixture() {
  const controller = new AbortController()
  const ctx: ConversationToolContext = {
    signal: controller.signal,
    getTodo: () => undefined,
    onTodo: vi.fn(),
    pendingAsks: new Map(),
    showAsk: vi.fn(),
    hideAsk: vi.fn(),
    onAnswer: vi.fn(),
  }
  return { controller, ctx, handlers: createConversationToolHandlers(ctx) }
}
const flush = () => Promise.resolve()

describe('conversation-owned tool handlers', () => {
  it('routes todo with its id and mutates once for duplicate dispatch', async () => {
    const { ctx, handlers } = fixture()
    const all = { ...handlers, onTask: vi.fn(), onMonitor: vi.fn() }
    const call = {
      toolName: 'todo',
      toolCallId: 't',
      input: { op: 'init', items: ['one'] },
    }
    const [a, b] = await Promise.all([
      dispatchClientTool(call, all),
      dispatchClientTool(call, all),
    ])
    expect(a).toEqual(b)
    expect(ctx.onTodo).toHaveBeenCalledTimes(1)
    expect(ctx.onTodo).toHaveBeenCalledWith(
      {
        phases: [
          { name: '', tasks: [{ content: 'one', status: 'in_progress' }] },
        ],
      },
      't'
    )
  })
  it('suspends once, settles once and ignores late answers', async () => {
    const { ctx, handlers } = fixture()
    const a = handlers.onAsk('a', input)
    const b = handlers.onAsk('a', input)
    await flush()
    const settle = ctx.pendingAsks.get('a')!
    settle(answers)
    settle(null)
    expect(await a).toEqual(await b)
    expect(ctx.showAsk).toHaveBeenCalledTimes(1)
    expect(ctx.hideAsk).toHaveBeenCalledTimes(1)
    expect(ctx.onAnswer).toHaveBeenCalledTimes(1)
    expect(ctx.pendingAsks.size).toBe(0)
  })
  it('Stop/delete cancellation removes the card, settles and prohibits late policy mutations', async () => {
    const { controller, ctx, handlers } = fixture()
    const pending = handlers.onAsk('a', input)
    await flush()
    const stale = ctx.pendingAsks.get('a')!
    controller.abort()
    expect(await pending).toMatchObject({
      isError: true,
      output: expect.stringContaining('Cancelled'),
    })
    stale(answers)
    expect(ctx.hideAsk).toHaveBeenCalledExactlyOnceWith('a')
    expect(ctx.pendingAsks.size).toBe(0)
    expect(ctx.onAnswer).not.toHaveBeenCalled()
    expect(
      await handlers.onTodo({ op: 'init', items: ['x'] }, 't')
    ).toHaveProperty('isError', true)
    expect(ctx.onTodo).not.toHaveBeenCalled()
  })
  it('fails closed when one id is reused across tool names', async () => {
    const { ctx, handlers } = fixture()
    await handlers.onTodo({ op: 'init', items: ['one'] }, 'same')
    expect(await handlers.onAsk('same', input)).toMatchObject({
      isError: true,
      output: expect.stringContaining('different tool'),
    })
    expect(ctx.showAsk).not.toHaveBeenCalled()
  })
  it('old answer/abort cannot hide or mutate a replacement owner', async () => {
    const { controller, ctx, handlers } = fixture()
    const pending = handlers.onAsk('a', input)
    await flush()
    const old = ctx.pendingAsks.get('a')!
    const replacement = vi.fn()
    ctx.pendingAsks.set('a', replacement)
    old(answers)
    controller.abort()
    expect(await pending).toHaveProperty('isError', true)
    expect(ctx.pendingAsks.get('a')).toBe(replacement)
    expect(ctx.hideAsk).not.toHaveBeenCalled()
    expect(ctx.onAnswer).not.toHaveBeenCalled()
  })
  it('show failure after reentrant replacement does not hide the new card', async () => {
    const { ctx } = fixture()
    const replacement = vi.fn()
    ctx.showAsk = () => {
      ctx.pendingAsks.set('a', replacement)
      throw new Error('show failed')
    }
    const handlers = createConversationToolHandlers(ctx)
    await expect(handlers.onAsk('a', input)).rejects.toThrow('show failed')
    expect(ctx.pendingAsks.get('a')).toBe(replacement)
    expect(ctx.hideAsk).not.toHaveBeenCalled()
  })
  it.each([
    { op: 'init', list: [null] },
    { op: 'init', items: [1] },
    { op: 'append', items: [null] },
    { op: 'init', list: [{ phase: 3, items: ['x'] }] },
    { op: 'append', phase: 3, items: ['x'] },
  ])(
    'refuses malformed todo without publishing a snapshot: %j',
    async (args) => {
      const { ctx, handlers } = fixture()
      expect(await handlers.onTodo(args, 't')).toHaveProperty('isError', true)
      expect(ctx.onTodo).not.toHaveBeenCalled()
    }
  )
  it.each([
    [],
    [{ id: 'q', selected: [] }],
    [{ id: 'q', selected: [], custom_input: ' ' }],
    [{ id: 'q', selected: ['A'], custom_input: 'mixed' }],
  ])('does not resume for empty/blank/mixed answers: %j', async (...[bad]) => {
    const { controller, ctx, handlers } = fixture()
    const pending = handlers.onAsk('a', input)
    await flush()
    ctx.pendingAsks.get('a')!(bad)
    expect(ctx.hideAsk).not.toHaveBeenCalled()
    controller.abort()
    await pending
  })
  it('refuses a later settled todo id with different input instead of replaying its output', async () => {
    const { ctx, handlers } = fixture()
    const first = await handlers.onTodo({ op: 'init', items: ['one'] }, 't')
    const later = await handlers.onTodo({ op: 'init', items: ['two'] }, 't')
    expect(later).toMatchObject({
      isError: true,
      output: expect.stringContaining('settled tool call id reused'),
    })
    expect(later).not.toEqual(first)
    expect(ctx.onTodo).toHaveBeenCalledTimes(1)
  })
  it('refuses a later settled ask id instead of returning the old answer or bypassing a new question', async () => {
    const { ctx, handlers } = fixture()
    const first = handlers.onAsk('a', input)
    await flush()
    ctx.pendingAsks.get('a')!(answers)
    await first
    const later = await handlers.onAsk('a', {
      questions: [{ ...input.questions[0], question: 'New question?' }],
    })
    expect(later).toMatchObject({
      isError: true,
      output: expect.stringContaining('settled tool call id reused'),
    })
    expect(later.output).not.toContain('selected')
    expect(ctx.showAsk).toHaveBeenCalledTimes(1)
  })
  it('preserves optional null todo parity including null phase fields', async () => {
    const { ctx, handlers } = fixture()
    const init = await handlers.onTodo(
      {
        op: 'init',
        list: [
          { phase: null, items: ['x'] },
          { phase: 'empty', items: null },
        ],
        items: null,
      },
      'init'
    )
    expect(init.isError).toBeUndefined()
    ctx.getTodo = () => JSON.parse(init.output)
    const done = await handlers.onTodo(
      { op: 'done', task: 'x', phase: null },
      'done'
    )
    expect(done.isError).toBeUndefined()
    expect(JSON.parse(done.output).phases[0].tasks[0].status).toBe('completed')
  })
  it('isolates identical ask ids across conversations', async () => {
    const a = fixture(),
      b = fixture()
    const pa = a.handlers.onAsk('same', input),
      pb = b.handlers.onAsk('same', input)
    await flush()
    a.controller.abort()
    b.ctx.pendingAsks.get('same')!(answers)
    expect(await pa).toHaveProperty('isError', true)
    expect(await pb).toEqual({ output: JSON.stringify(answers) })
  })
  it('keeps malformed answers suspended even with the existing delete-before-resolve API', async () => {
    const { ctx, handlers } = fixture()
    const pending = handlers.onAsk('a', input)
    await flush()
    const settle = ctx.pendingAsks.get('a')!
    ctx.pendingAsks.delete('a')
    settle([{ id: 'q', selected: ['invented'] }])
    expect(ctx.hideAsk).not.toHaveBeenCalled()
    expect(ctx.pendingAsks.get('a')).toBe(settle)
    settle(answers)
    expect(await pending).toEqual({ output: JSON.stringify(answers) })
  })
  it('rejects malformed requests without showing UI and distinguishes dismissal from Stop', async () => {
    const { ctx, handlers } = fixture()
    expect(await handlers.onAsk('bad', { questions: [null] })).toHaveProperty(
      'isError',
      true
    )
    expect(ctx.showAsk).not.toHaveBeenCalled()
    const pending = handlers.onAsk('a', input)
    await flush()
    ctx.pendingAsks.get('a')!(null)
    expect(await pending).toEqual({
      output: expect.stringContaining('did not answer'),
    })
  })
})

describe('transcript todo projection', () => {
  const list = {
    phases: [{ name: '', tasks: [{ content: 'one', status: 'completed' }] }],
  }
  const message = (output: unknown, state = 'output-available'): UIMessage =>
    ({
      id: 'm',
      role: 'assistant',
      parts: [{ type: 'tool-todo', toolCallId: 't', input: {}, state, output }],
    }) as UIMessage
  it('survives a JSON reload and ignores pending/error/malformed snapshots', () => {
    const history = [
      message(JSON.stringify(list)),
      message('bad'),
      message('{}'),
      message('{}', 'input-available'),
    ]
    expect(conversationTodos(JSON.parse(JSON.stringify(history)))).toEqual(list)
    expect(conversationTodos([])).toBeUndefined()
    expect(
      conversationTodos([message({ phases: [{ tasks: [] }] })])
    ).toBeUndefined()
  })
  it('honors an empty init/removal snapshot instead of resurrecting stale todos', () => {
    expect(conversationTodos([message(list), message({ phases: [] })])).toEqual(
      { phases: [] }
    )
  })
})
