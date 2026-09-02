import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Tool } from 'ai'

const { streamText, convertToModelMessages } = vi.hoisted(() => ({
  streamText: vi.fn(),
  convertToModelMessages: vi.fn(async (m: unknown) => m),
}))
vi.mock('ai', async (orig) => ({
  ...(await orig<typeof import('ai')>()),
  streamText,
  convertToModelMessages,
}))

import {
  dispatchedSubagentResult,
  intersectAllowedTools,
  parseSubagentRequest,
  parentToolNames,
  resolveSubagent,
  runSubagent,
  subagentCompletionNotice,
  subagentTools,
  SubagentInbox,
  MAX_PARALLEL_SUBAGENTS,
  SUBAGENT_INLINE_MAX,
  __testing,
} from '../coworkSubagent'
import type { StreamEvent } from '@/hooks/useCoworkRun'
import { MAX_SUBAGENT_STEPS } from '../coworkBudget'

const tools = (...names: string[]): Record<string, Tool> =>
  Object.fromEntries(names.map((n) => [n, {} as Tool]))

const definition = (over = {}) => ({
  name: 'researcher',
  description: 'reads things',
  system_prompt: 'You research.',
  allowed_tools: null as string[] | null,
  model: null as string | null,
  ...over,
})

describe('the task result and its completion ping', () => {
  it('names the file the answer will land in, and does not wait', () => {
    const out = dispatchedSubagentResult('researcher', 'c1', '/tmp/subagents/r.md')
    expect(out).toContain('/tmp/subagents/r.md')
    expect(out).toContain('Keep working')
  })

  it('promises the answer itself when there is no file to point at', () => {
    const out = dispatchedSubagentResult('researcher', 'c1', null)
    expect(out).toContain('You will be given its answer')
  })

  it('points the ping at the file rather than repeating the answer', () => {
    const out = subagentCompletionNotice({
      name: 'researcher',
      callId: 'c1',
      savedPath: '/tmp/subagents/r.md',
      output: 'the findings',
    })
    expect(out).toContain('/tmp/subagents/r.md')
    expect(out).not.toContain('the findings')
  })

  // Nothing else would carry it: with no file, the ping is the only delivery.
  it('carries the answer inline when nothing was saved, capped', () => {
    const output = 'y'.repeat(SUBAGENT_INLINE_MAX + 10)
    const out = subagentCompletionNotice({
      name: 'researcher',
      callId: 'c1',
      savedPath: null,
      output,
    })
    expect(out).toContain('y'.repeat(SUBAGENT_INLINE_MAX))
    expect(out.length).toBeLessThan(output.length + 200)
  })

  it('reports a failure as one, with no file named', () => {
    const out = subagentCompletionNotice({
      name: 'researcher',
      callId: 'c1',
      savedPath: null,
      output: 'the model refused',
      isError: true,
    })
    expect(out).toContain('failed: the model refused')
  })
})

describe('SubagentInbox', () => {
  it('reports work outstanding from dispatch until the ping is taken', async () => {
    const inbox = new SubagentInbox()
    expect(inbox.pending()).toBe(false)
    inbox.begin()
    expect(inbox.pending()).toBe(true)
    inbox.finish('done')
    // Still pending: the ping has been queued but not delivered, so a run that
    // stopped here would drop it.
    expect(inbox.pending()).toBe(true)
    expect(inbox.take()).toEqual(['done'])
    expect(inbox.take()).toEqual([])
    expect(inbox.pending()).toBe(false)
  })

  it('wakes a waiter when a child finishes', async () => {
    const inbox = new SubagentInbox()
    inbox.begin()
    let woke = false
    const waiting = inbox.wait().then(() => {
      woke = true
    })
    await Promise.resolve()
    expect(woke).toBe(false)
    inbox.finish('done')
    await waiting
    expect(woke).toBe(true)
  })

  it('never parks when there is nothing to wait for', async () => {
    await expect(new SubagentInbox().wait()).resolves.toBeUndefined()
  })

  /// A cancelled run aborts its children, and nothing would ever file their
  /// pings — so the wait has to end with the run, not with the child.
  it('releases the waiter on cancellation', async () => {
    const inbox = new SubagentInbox()
    inbox.begin()
    const controller = new AbortController()
    const waiting = inbox.wait(controller.signal)
    controller.abort()
    await expect(waiting).resolves.toBeUndefined()
  })
})

describe('parseSubagentRequest', () => {
  it('requires a name and a description', () => {
    expect(parseSubagentRequest({})).toContain('subagent_name')
    // The child cannot see the parent's conversation, so an empty brief is a
    // guaranteed-useless run rather than a recoverable one.
    expect(parseSubagentRequest({ subagent_name: 'x' })).toContain(
      'description'
    )
  })

  it('keeps an inline prompt and allowlist', () => {
    const req = parseSubagentRequest({
      subagent_name: 'oneoff',
      description: 'do it',
      system_prompt: 'You are terse.',
      allowed_tools: ['read', 42, 'grep'],
    })
    expect(req).toEqual({
      subagent_name: 'oneoff',
      description: 'do it',
      system_prompt: 'You are terse.',
      allowed_tools: ['read', 'grep'],
    })
  })

  it('drops a blank inline prompt rather than running an empty role', () => {
    const req = parseSubagentRequest({
      subagent_name: 'x',
      description: 'd',
      system_prompt: '   ',
    })
    expect(req).not.toHaveProperty('system_prompt')
  })
})

describe('intersectAllowedTools', () => {
  const parent = ['read', 'grep', 'write', 'skill_list', 'skill_read']

  it('inherits the parent set when neither side narrows', () => {
    expect(intersectAllowedTools(null, null, parent)).toEqual({ tools: null })
  })

  it('narrows to the definition, dropping what the parent lacks', () => {
    // The definition's author cannot know the parent's mode, so a tool the
    // parent lacks is dropped rather than raised as an error.
    const out = intersectAllowedTools(['read', 'bash'], null, parent)
    expect(out).toEqual({ tools: ['read', 'skill_list', 'skill_read'] })
  })

  it('refuses a request outside the definition', () => {
    expect(
      intersectAllowedTools(['read'], ['write'], parent)
    ).toEqual({
      error: expect.stringContaining("outside the subagent definition's"),
    })
  })

  it('refuses a request the parent cannot call', () => {
    // This is what makes plan mode and a withheld `bash` propagate: the parent's
    // advertised set is the ceiling.
    expect(intersectAllowedTools(null, ['bash'], parent)).toEqual({
      error: expect.stringContaining('not available to this run'),
    })
  })

  it('never widens past the parent', () => {
    const out = intersectAllowedTools(null, ['read'], parent)
    expect(out).toEqual({ tools: ['read', 'skill_list', 'skill_read'] })
  })

  it('always grants the read-side skill tools', () => {
    // Ported from `SUBAGENT_SKILL_TOOLS`: a Claude-style `tools:` list never
    // names them, so a narrowed set must not strip them.
    const out = intersectAllowedTools(['read'], null, parent)
    expect(out).toEqual({ tools: ['read', ...__testing.SUBAGENT_SKILL_TOOLS] })
  })

  it('does not grant skill tools the parent itself lacks', () => {
    expect(intersectAllowedTools(['read'], null, ['read'])).toEqual({
      tools: ['read'],
    })
  })
})

describe('resolveSubagent', () => {
  const parent = ['read', 'grep', 'skill_list', 'skill_read']

  it('uses a saved definition', () => {
    const out = resolveSubagent(
      { subagent_name: 'researcher', description: 'go' },
      [definition({ allowed_tools: ['read'], model: 'm-1' })],
      parent
    )
    expect(out).toEqual({
      name: 'researcher',
      systemPrompt: 'You research.',
      allowedTools: ['read', 'skill_list', 'skill_read'],
      model: 'm-1',
    })
  })

  it('runs a one-off from an inline prompt', () => {
    const out = resolveSubagent(
      {
        subagent_name: 'oneoff',
        description: 'go',
        system_prompt: 'You are terse.',
        allowed_tools: ['read'],
      },
      [],
      parent
    )
    expect(out).toEqual({
      name: 'oneoff',
      systemPrompt: 'You are terse.',
      allowedTools: ['read', 'skill_list', 'skill_read'],
      model: null,
    })
  })

  it('errors on an unknown name with no inline prompt', () => {
    const out = resolveSubagent(
      { subagent_name: 'ghost', description: 'go' },
      [],
      parent
    )
    expect(out).toEqual({
      error: expect.stringContaining("unknown subagent 'ghost'"),
    })
  })

  it('lets a call site narrow a saved definition', () => {
    const out = resolveSubagent(
      {
        subagent_name: 'researcher',
        description: 'go',
        allowed_tools: ['read'],
      },
      [definition({ allowed_tools: ['read', 'grep'] })],
      parent
    )
    expect(out).toMatchObject({
      allowedTools: ['read', 'skill_list', 'skill_read'],
    })
  })
})

describe('subagentTools', () => {
  it('withholds the parent-only tools whatever the allowlist says', () => {
    // `task` is the depth cap; `ask` and `todo` belong to the parent's
    // conversation, which no child is attached to.
    const out = subagentTools(
      tools('read', 'task', 'ask', 'todo'),
      ['read', 'task', 'ask', 'todo']
    )
    expect(Object.keys(out)).toEqual(['read'])
  })

  it('narrows to the allowlist', () => {
    const out = subagentTools(tools('read', 'grep', 'write'), ['read'])
    expect(Object.keys(out)).toEqual(['read'])
  })

  it('inherits everything offerable when the allowlist is null', () => {
    const out = subagentTools(tools('read', 'grep', 'task'), null)
    expect(Object.keys(out)).toEqual(['read', 'grep'])
  })
})

describe('parentToolNames', () => {
  it('excludes what a child can never be granted', () => {
    expect(parentToolNames(tools('read', 'task', 'ask', 'todo'))).toEqual([
      'read',
    ])
  })
})

describe('Semaphore', () => {
  it('runs up to the cap at once and queues the rest in order', async () => {
    const s = new __testing.Semaphore(2)
    const a = await s.acquire()
    await s.acquire()
    expect(s.waiting).toBe(0)
    expect(s.available).toBe(0)

    const order: number[] = []
    const third = s.acquire().then((r) => {
      order.push(3)
      return r
    })
    const fourth = s.acquire().then((r) => {
      order.push(4)
      return r
    })
    expect(s.waiting).toBe(2)

    a()
    ;(await third)()
    ;(await fourth)()
    // FIFO, so the queue position reported to the UI is the one it gets.
    expect(order).toEqual([3, 4])
  })
})

// A `finish` chunk carrying usage, matching what `toUIMessageStream` emits.
const chunkStream = (chunks: unknown[]) =>
  new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk)
      c.close()
    },
  })

const textStep = (text: string, usage = 12) => [
  { type: 'text-delta', delta: text },
  { type: 'finish', messageMetadata: { usage: { totalTokens: usage } } },
]

const toolStep = (id: string, name: string, input: unknown) => [
  { type: 'tool-input-start', toolCallId: id, toolName: name },
  { type: 'tool-input-available', toolCallId: id, toolName: name, input },
  { type: 'finish', messageMetadata: { usage: { totalTokens: 5 } } },
]

function mockSteps(steps: unknown[][]) {
  let i = 0
  streamText.mockImplementation(() => ({
    toUIMessageStream: () => chunkStream(steps[i++] ?? []),
  }))
}

const baseOpts = (over = {}) => ({
  resolved: {
    name: 'researcher',
    systemPrompt: 'You research.',
    allowedTools: null,
    model: null,
  },
  description: 'find the config',
  model: 'model-instance' as never,
  parentTools: tools('read', 'task', 'ask'),
  system: {
    workspacePath: '/ws/s1',
    readOnlyFolder: null,
    bashAvailable: false,
  },
  dispatch: vi.fn(async () => ({ output: 'ok' })),
  signal: new AbortController().signal,
  events: {
    onQueued: vi.fn(),
    onStart: vi.fn(),
    onInner: vi.fn(),
    onEnd: vi.fn(),
  },
  ...over,
})

describe('runSubagent', () => {
  beforeEach(() => {
    streamText.mockReset()
    convertToModelMessages.mockClear()
  })

  it('returns the final text as the task output', async () => {
    mockSteps([textStep('the config is at /etc/x')])
    const opts = baseOpts()
    const out = await runSubagent(opts)
    expect(out.output).toBe('the config is at /etc/x')
    expect(out.isError).toBeFalsy()
    expect(opts.events.onStart).toHaveBeenCalled()
    expect(opts.events.onEnd).toHaveBeenCalledWith(
      expect.objectContaining({ total_tokens: 12 })
    )
  })

  it('reuses the parent model instance rather than creating one', async () => {
    mockSteps([textStep('done')])
    await runSubagent(baseOpts())
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'model-instance' })
    )
  })

  it('never advertises the parent-only tools to the child', async () => {
    mockSteps([textStep('done')])
    await runSubagent(baseOpts())
    const passed = streamText.mock.calls[0][0].tools as Record<string, Tool>
    expect(Object.keys(passed)).toEqual(['read'])
  })

  it('starts from a fresh history: only the description', async () => {
    mockSteps([textStep('done')])
    await runSubagent(baseOpts())
    const sent = streamText.mock.calls[0][0].messages as Array<{
      role: string
      parts: Array<{ text: string }>
    }>
    expect(sent).toHaveLength(1)
    expect(sent[0].role).toBe('user')
    expect(sent[0].parts[0].text).toBe('find the config')
  })

  it('puts the sandbox path in the child system prompt', async () => {
    mockSteps([textStep('done')])
    await runSubagent(baseOpts())
    const system = streamText.mock.calls[0][0].system as string
    // A child cannot guess the sandbox path, and the Rust override would have
    // replaced the workspace block wholesale.
    expect(system).toContain('You research.')
    expect(system).toContain('/ws/s1')
    expect(system).toContain('cannot dispatch')
  })

  it('reports the child transcript as inner stream events', async () => {
    mockSteps([toolStep('c1', 'read', { path: 'a' }), textStep('found it')])
    const opts = baseOpts()
    await runSubagent(opts)
    const kinds = (opts.events.onInner.mock.calls as [StreamEvent][]).map(
      ([e]) => e.type
    )
    // `applyInnerToTurns` consumes exactly these, unchanged from the Rust shape.
    expect(kinds).toContain('tool_call_started')
    expect(kinds).toContain('tool_call')
    expect(kinds).toContain('tool_result')
    expect(kinds).toContain('token')
  })

  it('dispatches the child tool calls', async () => {
    mockSteps([toolStep('c1', 'read', { path: 'a' }), textStep('done')])
    const opts = baseOpts()
    await runSubagent(opts)
    expect(opts.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'read' }),
      expect.anything()
    )
  })

  it('reports a step cap as an error, keeping the partial output', async () => {
    mockSteps(
      Array.from({ length: 4 }, (_, i) =>
        toolStep(`c${i}`, 'read', { path: 'a' })
      )
    )
    const out = await runSubagent(baseOpts({ maxSteps: 2 }))
    // The parent can finish the errand itself, but not if it believes the child
    // answered in full.
    expect(out.isError).toBe(true)
    expect(out.output).toContain('2-step budget')
  })

  it('defaults to the subagent step cap, not the parent one', async () => {
    mockSteps(
      Array.from({ length: MAX_SUBAGENT_STEPS + 1 }, (_, i) =>
        toolStep(`c${i}`, 'read', { path: 'a' })
      )
    )
    const out = await runSubagent(baseOpts())
    expect(out.output).toContain(`${MAX_SUBAGENT_STEPS}-step budget`)
  })

  it('returns cleanly when already aborted', async () => {
    mockSteps([textStep('never')])
    const controller = new AbortController()
    controller.abort()
    const opts = baseOpts({ signal: controller.signal })
    const out = await runSubagent(opts)
    expect(out.isError).toBe(true)
    expect(streamText).not.toHaveBeenCalled()
    // Still closed out, so a caller that opened a lane on `onQueued` does not
    // leave a spinner running.
    expect(opts.events.onEnd).toHaveBeenCalled()
  })

  it('surfaces a stream error as the task result', async () => {
    streamText.mockImplementation(() => ({
      toUIMessageStream: () =>
        chunkStream([{ type: 'error', errorText: 'context overflow' }]),
    }))
    const out = await runSubagent(baseOpts())
    expect(out).toMatchObject({ output: 'context overflow', isError: true })
  })

  it('says so when the child produced no answer', async () => {
    mockSteps([[{ type: 'finish', messageMetadata: {} }]])
    const out = await runSubagent(baseOpts())
    expect(out.output).toContain('no answer')
  })

  it('caps concurrency at three', () => {
    expect(MAX_PARALLEL_SUBAGENTS).toBe(3)
  })

  it('queues the fourth child and reports its position', async () => {
    let releaseAll = () => {}
    const held = new Promise<void>((r) => {
      releaseAll = r
    })
    streamText.mockImplementation(() => ({
      toUIMessageStream: () =>
        new ReadableStream({
          async start(c) {
            await held
            c.enqueue({ type: 'text-delta', delta: 'done' })
            c.close()
          },
        }),
    }))

    const runs = Array.from({ length: 4 }, () => baseOpts())
    const all = Promise.all(runs.map((o) => runSubagent(o)))
    // Let the three admitted children reach streamText.
    for (let i = 0; i < 20; i += 1) await Promise.resolve()

    expect(streamText).toHaveBeenCalledTimes(MAX_PARALLEL_SUBAGENTS)
    const queued = runs.filter((o) => o.events.onQueued.mock.calls.length > 0)
    expect(queued).toHaveLength(1)
    expect(queued[0].events.onQueued).toHaveBeenCalledWith(1)
    expect(queued[0].events.onStart).not.toHaveBeenCalled()

    releaseAll()
    await all
    // The queued child runs once a permit frees, rather than being dropped.
    expect(streamText).toHaveBeenCalledTimes(4)
    expect(queued[0].events.onStart).toHaveBeenCalled()
  })
})
