import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  conversationAskCard,
  dispatchConversationClientTool,
  dropAllConversationClientThreads,
  dropConversationClientThread,
  finishConversationClientRun,
  hasConversationClientEntry,
  respondConversationAsk,
  subscribeConversationAsk,
} from '../conversationClientTools'
import { conversationTodos } from '../conversationTaskPresentation'

const askInput = {
  questions: [
    { id: 'q', question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] },
  ],
}
const good = [{ id: 'q', selected: ['A'] }]
const flush = () => new Promise((r) => setTimeout(r, 0))

const todoMessage = (output: string): UIMessage =>
  ({
    id: 'm',
    role: 'assistant',
    parts: [
      {
        type: 'tool-todo',
        toolCallId: 'c',
        state: 'output-available',
        input: {},
        output,
      },
    ],
  }) as unknown as UIMessage

const threads = ['t1', 't2']
afterEach(() => threads.forEach(dropConversationClientThread))

function run(threadId = 't1', messages: readonly UIMessage[] = []) {
  const controller = new AbortController()
  let current = messages
  const call = (toolName: string, toolCallId: string, input: unknown) =>
    dispatchConversationClientTool(
      { toolName, toolCallId, input },
      { threadId, signal: controller.signal, getMessages: () => current }
    )
  return {
    controller,
    call,
    setMessages: (next: readonly UIMessage[]) => (current = next),
  }
}

describe('conversationClientTools: todo', () => {
  it('serial init then done returns canonical JSON before the transcript commits', async () => {
    const { call } = run()
    const init = await call('todo', 'a', { op: 'init', items: ['one', 'two'] })
    expect(JSON.parse(init!.output)).toEqual({
      phases: [
        {
          name: '',
          tasks: [
            { content: 'one', status: 'in_progress' },
            { content: 'two', status: 'pending' },
          ],
        },
      ],
    })
    // Transcript still empty: the pending bridge supplies the init result.
    const done = await call('todo', 'b', { op: 'done', task: 'one' })
    expect(done!.isError).toBeUndefined()
    expect(JSON.parse(done!.output).phases[0].tasks).toEqual([
      { content: 'one', status: 'completed' },
      { content: 'two', status: 'in_progress' },
    ])
  })

  it('a reloaded transcript is the authority for the next call', async () => {
    const first = run()
    const init = await first.call('todo', 'a', { op: 'init', items: ['x'] })
    const messages = [todoMessage(init!.output)]
    expect(conversationTodos(messages)).toEqual(JSON.parse(init!.output))

    // A new run (fresh signal) after reload reads the transcript only.
    finishConversationClientRun('t1')
    const second = run('t1', messages)
    const view = await second.call('todo', 'v', { op: 'view' })
    expect(JSON.parse(view!.output)).toEqual(JSON.parse(init!.output))
  })

  it('finish releases the pending bridge; canonical wins afterwards', async () => {
    const { call, setMessages } = run()
    await call('todo', 'a', { op: 'init', items: ['x'] })
    finishConversationClientRun('t1')
    const view = await call('todo', 'v', { op: 'view' })
    expect(JSON.parse(view!.output)).toEqual({ phases: [] }) // nothing canonical, bridge gone
    const canonical = { phases: [{ name: '', tasks: [{ content: 'y', status: 'in_progress' }] }] }
    setMessages([todoMessage(JSON.stringify(canonical))])
    const again = await call('todo', 'w', { op: 'view' })
    expect(JSON.parse(again!.output)).toEqual(canonical)
  })

  it('an error outcome does not publish a snapshot', async () => {
    const { call } = run()
    const bad = await call('todo', 'a', { op: 'init', items: [1] })
    expect(bad).toMatchObject({ isError: true })
    const view = await call('todo', 'v', { op: 'view' })
    expect(JSON.parse(view!.output)).toEqual({ phases: [] })
  })

  it('abort releases the aborted run\'s own pending bridge', async () => {
    const { call, controller } = run()
    await call('todo', 'a', { op: 'init', items: ['x'] })
    // A pending bridge keeps the entry non-idle: prune retains it.
    subscribeConversationAsk('t1', () => {})()
    expect(hasConversationClientEntry('t1')).toBe(true)
    controller.abort()
    // No finish/drop ran: only the abort listener can have cleared the bridge,
    // which makes the entry idle so the next prune removes it.
    subscribeConversationAsk('t1', () => {})()
    expect(hasConversationClientEntry('t1')).toBe(false)
    const next = run()
    const view = await next.call('todo', 'v', { op: 'view' })
    expect(JSON.parse(view!.output)).toEqual({ phases: [] })
  })
})

describe('conversationClientTools: ask', () => {
  it('pending card survives unsubscribe/resubscribe', async () => {
    const { call } = run()
    const first = vi.fn()
    const off = subscribeConversationAsk('t1', first)
    const pending = call('ask', 'ask1', askInput)
    await flush()
    expect(first).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'ask1' })
    )
    off()
    expect(conversationAskCard('t1')).toMatchObject({ id: 'ask1' })

    const second = vi.fn()
    const off2 = subscribeConversationAsk('t1', second)
    expect(conversationAskCard('t1')).toMatchObject({ id: 'ask1' })
    respondConversationAsk('t1', 'ask1', good)
    const outcome = await pending
    expect(JSON.parse(outcome!.output)).toEqual(good)
    expect(second).toHaveBeenLastCalledWith(null)
    expect(conversationAskCard('t1')).toBeNull()
    off2()
  })

  it("another thread cannot see or answer this thread's card", async () => {
    const { call } = run('t1')
    const other = vi.fn()
    const off = subscribeConversationAsk('t2', other)
    const pending = call('ask', 'ask1', askInput)
    await flush()
    expect(conversationAskCard('t2')).toBeNull()
    expect(other).not.toHaveBeenCalled()
    respondConversationAsk('t2', 'ask1', good)
    expect(conversationAskCard('t1')).toMatchObject({ id: 'ask1' })
    respondConversationAsk('t1', 'ask1', null)
    await pending
    off()
  })

  it('validates the response once: invalid keeps the card, valid settles, replay is ignored', async () => {
    const { call } = run()
    const pending = call('ask', 'ask1', askInput)
    await flush()
    respondConversationAsk('t1', 'ask1', [{ id: 'q', selected: ['nope'] }])
    expect(conversationAskCard('t1')).toMatchObject({ id: 'ask1' })
    respondConversationAsk('t1', 'ask1', good)
    expect(conversationAskCard('t1')).toBeNull()
    const outcome = await pending
    respondConversationAsk('t1', 'ask1', [{ id: 'q', selected: ['B'] }])
    expect(JSON.parse(outcome!.output)).toEqual(good)
  })

  it('abort settles the call as cancelled and clears the card', async () => {
    const { call, controller } = run()
    const pending = call('ask', 'ask1', askInput)
    await flush()
    controller.abort()
    expect(await pending).toMatchObject({
      isError: true,
      output: expect.stringContaining('Cancelled'),
    })
    expect(conversationAskCard('t1')).toBeNull()
    respondConversationAsk('t1', 'ask1', good) // late answer: no-op
  })

  it('thread delete settles a suspended ask with null and clears the card', async () => {
    const { call } = run()
    const seen = vi.fn()
    const off = subscribeConversationAsk('t1', seen)
    const pending = call('ask', 'ask1', askInput)
    await flush()
    dropConversationClientThread('t1')
    const outcome = await pending
    expect(outcome!.output).not.toContain('"selected"')
    expect(conversationAskCard('t1')).toBeNull()
    expect(seen).toHaveBeenLastCalledWith(null)
    off()
  })

  it('a pending ask survives finish (the handler is still waiting)', async () => {
    const { call } = run()
    const pending = call('ask', 'ask1', askInput)
    await flush()
    finishConversationClientRun('t1')
    expect(conversationAskCard('t1')).toMatchObject({ id: 'ask1' })
    respondConversationAsk('t1', 'ask1', good)
    await pending
  })
})

describe('conversation runtime global cleanup', () => {
  it('settles an orphan ask even when no Chat session was created', async () => {
    const pending = run('t1').call('ask', 'orphan-ask', askInput)
    await flush()
    expect(conversationAskCard('t1')).not.toBeNull()
    dropAllConversationClientThreads()
    await expect(pending).resolves.toBeDefined()
    expect(conversationAskCard('t1')).toBeNull()
  })
})

describe('conversationClientTools: routing', () => {
  it('returns undefined for unknown names without creating state or executing', async () => {
    const { call } = run()
    expect(await call('shell', 'x', { command: 'ls' })).toBeUndefined()
    expect(await call('fetch', 'y', {})).toBeUndefined()
    expect(conversationAskCard('t1')).toBeNull()
  })

  it('task/monitor are refused, not executed', async () => {
    const { call } = run()
    expect(await call('task', 'x', {})).toMatchObject({ isError: true })
    expect(await call('monitor', 'y', {})).toMatchObject({ isError: true })
  })
})
