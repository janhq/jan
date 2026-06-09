import { describe, expect, it } from 'vitest'
import { CodexAppServerSession } from '../client'
import type { CodexProcess, CodexProcessExit, Unsubscribe } from '../types'
import type { CodexProcessSpawner } from '../process-manager'

class ScriptedCodexProcess implements CodexProcess {
  writes: unknown[] = []
  spawnArgs: string[] = []
  spawnEnv: Record<string, string | undefined> = {}
  spawnCwd: string | undefined
  completeTurn = true
  turnServerRequests: Array<{
    id: string | number
    method: string
    params?: unknown
  }> = []
  turnNotifications: Array<{ method: string; params?: unknown }> = []

  private stdoutListeners = new Set<(line: string) => void>()
  private stderrListeners = new Set<(line: string) => void>()
  private exitListeners = new Set<(exit: CodexProcessExit) => void>()

  writeLine(line: string) {
    const message = JSON.parse(line)
    this.writes.push(message)
    this.respondToClientMessage(message)
  }

  onStdoutLine(callback: (line: string) => void): Unsubscribe {
    this.stdoutListeners.add(callback)
    return () => this.stdoutListeners.delete(callback)
  }

  onStderrLine(callback: (line: string) => void): Unsubscribe {
    this.stderrListeners.add(callback)
    return () => this.stderrListeners.delete(callback)
  }

  onExit(callback: (exit: CodexProcessExit) => void): Unsubscribe {
    this.exitListeners.add(callback)
    return () => this.exitListeners.delete(callback)
  }

  kill() {
    this.exitListeners.forEach((callback) => callback({ code: 0 }))
  }

  exit(exit: CodexProcessExit = { code: 1, signal: null }) {
    this.exitListeners.forEach((callback) => callback(exit))
  }

  private respondToClientMessage(message: { id?: number | string; method?: string; params?: unknown }) {
    if (message.method === 'initialize') {
      this.emit({ id: message.id, result: { userAgent: 'codex-test', codexHome: '/tmp/codex' } })
    }

    if (message.method === 'thread/start') {
      this.emit({
        id: message.id,
        result: {
          thread: this.thread('codex-thread-1'),
          model: 'gpt-test',
          modelProvider: 'openai',
          serviceTier: null,
          cwd: '/repo',
          instructionSources: [],
          approvalPolicy: 'never',
          approvalsReviewer: 'app',
          sandbox: { mode: 'workspace-write' },
          reasoningEffort: null,
        },
      })
      this.emit({ method: 'thread/started', params: { thread: this.thread('codex-thread-1') } })
    }

    if (message.method === 'thread/resume') {
      const threadId = isRecord(message.params)
        ? String(message.params.threadId)
        : 'codex-thread-1'
      this.emit({
        id: message.id,
        result: {
          thread: this.thread(threadId),
          model: 'gpt-test',
          modelProvider: 'openai',
          serviceTier: null,
          cwd: '/repo',
          instructionSources: [],
          approvalPolicy: 'never',
          approvalsReviewer: 'app',
          sandbox: { mode: 'workspace-write' },
          reasoningEffort: null,
        },
      })
      this.emit({ method: 'thread/started', params: { thread: this.thread(threadId) } })
    }

    if (message.method === 'turn/steer') {
      const threadId = isRecord(message.params)
        ? String(message.params.threadId)
        : 'codex-sub-1'
      const turn = this.turn('steer-turn-1', 'running')
      this.emit({ id: message.id, result: { turn } })
      this.emit({ method: 'turn/started', params: { threadId, turn } })
      this.emit({
        method: 'item/agentMessage/delta',
        params: {
          threadId,
          turnId: 'steer-turn-1',
          itemId: 'assistant-steer',
          delta: 'steered response',
        },
      })
      this.emit({
        method: 'turn/completed',
        params: { threadId, turn: this.turn('steer-turn-1', 'completed') },
      })
    }

    if (message.method === 'turn/start') {
      const turn = this.turn('turn-1', 'running')
      this.emit({ id: message.id, result: { turn } })
      this.emit({
        method: 'thread/status/changed',
        params: { threadId: 'codex-thread-1', status: { type: 'active' } },
      })
      this.emit({ method: 'turn/started', params: { threadId: 'codex-thread-1', turn } })
      this.turnServerRequests.forEach((request) => this.emit(request))
      this.turnNotifications.forEach((notification) => this.emit(notification))
      this.emit({
        method: 'item/started',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          item: {
            type: 'commandExecution',
            id: 'command-1',
            command: 'pwd',
            status: 'inProgress',
          },
        },
      })
      this.emit({
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'assistant-1',
          delta: 'hello from codex',
        },
      })
      this.emit({
        method: 'item/completed',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          item: {
            type: 'commandExecution',
            id: 'command-1',
            command: 'pwd',
            status: 'completed',
          },
        },
      })
      if (!this.completeTurn) return
      this.emit({
        method: 'turn/completed',
        params: { threadId: 'codex-thread-1', turn: this.turn('turn-1', 'completed') },
      })
    }
  }

  private thread(id: string) {
    return {
      id,
      sessionId: 'session-1',
      forkedFromId: null,
      parentThreadId: null,
      preview: '',
      ephemeral: false,
      modelProvider: 'openai',
      createdAt: 1,
      updatedAt: 1,
      status: 'idle',
      path: null,
      cwd: '/repo',
      cliVersion: 'test',
      source: 'app_server',
      threadSource: null,
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      turns: [],
    }
  }

  private turn(id: string, status: string) {
    return {
      id,
      items: [],
      itemsView: { type: 'all' },
      status,
      error: null,
      startedAt: 1,
      completedAt: status === 'completed' ? 2 : null,
      durationMs: status === 'completed' ? 100 : null,
    }
  }

  private emit(value: unknown) {
    const line = JSON.stringify(value)
    this.stdoutListeners.forEach((callback) => callback(line))
  }
}

describe('CodexAppServerSession', () => {
  it('starts app-server, initializes it, and streams a chat turn', async () => {
    const process = new ScriptedCodexProcess()
    const spawner: CodexProcessSpawner = {
      spawn(command, args, options) {
        process.spawnArgs = [command, ...args]
        process.spawnEnv = options.env
        process.spawnCwd = options.cwd
        return process
      },
    }
    const session = new CodexAppServerSession({
      spawner,
      options: {
        codexBinaryPath: '/Applications/Codex.app/Contents/Resources/codex',
        codexHome: '/repo/.jan/codex-home',
        cwd: '/repo',
        model: 'gpt-test',
        modelProvider: 'openai',
        approvalPolicy: 'never',
      },
    })

    const init = await session.initialize()
    expect(init.userAgent).toBe('codex-test')
    expect(process.spawnArgs).toContain('app-server')
    expect(process.spawnArgs).toContain('--stdio')
    expect(process.spawnEnv.CODEX_HOME).toBe('/repo/.jan/codex-home')
    expect(process.spawnCwd).toBe('/repo')

    const events = []
    for await (const event of session.sendMessage({
      appThreadId: 'jan-thread-1',
      text: 'say hello',
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      {
        type: 'thread_started',
        appThreadId: 'jan-thread-1',
        threadId: 'codex-thread-1',
        thread: expect.objectContaining({ id: 'codex-thread-1' }),
      },
      {
        type: 'thread_status',
        threadId: 'codex-thread-1',
        status: { type: 'active' },
      },
      {
        type: 'turn_started',
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        turn: expect.objectContaining({ id: 'turn-1' }),
      },
      {
        type: 'item_started',
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        itemId: 'command-1',
        item: expect.objectContaining({ id: 'command-1', type: 'commandExecution' }),
      },
      {
        type: 'assistant_delta',
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        itemId: 'assistant-1',
        delta: 'hello from codex',
      },
      {
        type: 'item_completed',
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        itemId: 'command-1',
        item: expect.objectContaining({ id: 'command-1', status: 'completed' }),
      },
      {
        type: 'turn_completed',
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        turn: expect.objectContaining({ id: 'turn-1', status: 'completed' }),
      },
    ])

    expect(process.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'turn/start',
          params: expect.objectContaining({
            threadId: 'codex-thread-1',
            input: [{ type: 'text', text: 'say hello', text_elements: [] }],
          }),
        }),
      ])
    )
  })

  it('emits an error event when app-server exits mid-turn', async () => {
    const process = new ScriptedCodexProcess()
    process.completeTurn = false
    const spawner: CodexProcessSpawner = {
      spawn() {
        return process
      },
    }
    const session = new CodexAppServerSession({
      spawner,
      options: {
        cwd: '/repo',
        model: 'gpt-test',
        modelProvider: 'openai',
        approvalPolicy: 'never',
      },
    })

    const iterator = session.sendMessage({
      appThreadId: 'jan-thread-1',
      text: 'say hello',
    })

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: expect.objectContaining({ type: 'thread_started' }),
    })
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: expect.objectContaining({ type: 'thread_status' }),
    })
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: expect.objectContaining({ type: 'turn_started' }),
    })
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: expect.objectContaining({ type: 'item_started' }),
    })
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: expect.objectContaining({ type: 'assistant_delta' }),
    })
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: expect.objectContaining({ type: 'item_completed' }),
    })

    process.exit({ code: 7, signal: null })

    await expect(nextWithTimeout(iterator)).resolves.toEqual({
      done: false,
      value: {
        type: 'error',
        error: expect.objectContaining({
          message: expect.stringContaining('Codex app-server exited with code 7'),
        }),
      },
    })
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    })
  })

  it('reconnects after process exit and resumes the mapped Codex thread', async () => {
    const firstProcess = new ScriptedCodexProcess()
    const secondProcess = new ScriptedCodexProcess()
    const processes = [firstProcess, secondProcess]
    const spawner: CodexProcessSpawner = {
      spawn() {
        const process = processes.shift()
        if (!process) throw new Error('unexpected extra spawn')
        return process
      },
    }
    const session = new CodexAppServerSession({
      spawner,
      options: {
        cwd: '/repo',
        model: 'gpt-test',
        modelProvider: 'openai',
        approvalPolicy: 'never',
      },
    })

    await collectEvents(
      session.sendMessage({
        appThreadId: 'jan-thread-1',
        text: 'first message',
      })
    )
    firstProcess.exit({ code: 1, signal: null })

    const secondEvents = await collectEvents(
      session.sendMessage({
        appThreadId: 'jan-thread-1',
        text: 'second message',
      })
    )

    expect(firstProcess.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'thread/start' }),
        expect.objectContaining({
          method: 'turn/start',
          params: expect.objectContaining({ threadId: 'codex-thread-1' }),
        }),
      ])
    )
    expect(secondProcess.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'thread/resume',
          params: expect.objectContaining({ threadId: 'codex-thread-1' }),
        }),
        expect.objectContaining({
          method: 'turn/start',
          params: expect.objectContaining({
            threadId: 'codex-thread-1',
            input: [{ type: 'text', text: 'second message', text_elements: [] }],
          }),
        }),
      ])
    )
    expect(secondProcess.writes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ method: 'thread/start' })])
    )
    expect(secondEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'thread_started',
          threadId: 'codex-thread-1',
        }),
        expect.objectContaining({
          type: 'turn_completed',
          threadId: 'codex-thread-1',
        }),
      ])
    )
  })

  it('maps legacy app-server approval requests to approval events', async () => {
    const process = new ScriptedCodexProcess()
    process.turnServerRequests = [
      {
        id: 'approval-1',
        method: 'execCommandApproval',
        params: {
          command: ['npm', 'test'],
          cwd: '/repo',
          reason: 'Run tests',
        },
      },
      {
        id: 'approval-2',
        method: 'applyPatchApproval',
        params: {
          grantRoot: '/repo',
          reason: 'Edit files',
        },
      },
    ]
    const spawner: CodexProcessSpawner = {
      spawn() {
        return process
      },
    }
    const session = new CodexAppServerSession({
      spawner,
      options: {
        cwd: '/repo',
        model: 'gpt-test',
        modelProvider: 'openai',
        approvalPolicy: 'on-request',
      },
    })

    const events = await collectEvents(
      session.sendMessage({
        appThreadId: 'jan-thread-1',
        text: 'run the tests',
      })
    )

    expect(events).toEqual(
      expect.arrayContaining([
        {
          type: 'approval_request',
          request: expect.objectContaining({ method: 'execCommandApproval' }),
        },
        {
          type: 'approval_request',
          request: expect.objectContaining({ method: 'applyPatchApproval' }),
        },
      ])
    )
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'server_request',
          request: expect.objectContaining({ method: 'execCommandApproval' }),
        }),
      ])
    )
  })

  it('maps indexed reasoning notifications and server request lifecycle events', async () => {
    const process = new ScriptedCodexProcess()
    process.turnServerRequests = [
      {
        id: 'request-1',
        method: 'item/permissions/requestApproval',
        params: { permissions: { filesystem: 'read' } },
      },
    ]
    process.turnNotifications = [
      {
        method: 'item/reasoning/summaryPartAdded',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'reasoning-1',
          summaryIndex: 0,
        },
      },
      {
        method: 'item/reasoning/summaryTextDelta',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'reasoning-1',
          summaryIndex: 0,
          delta: 'summary',
        },
      },
      {
        method: 'item/reasoning/textDelta',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'reasoning-1',
          contentIndex: 1,
          delta: 'details',
        },
      },
      {
        method: 'serverRequest/resolved',
        params: {
          requestId: 'request-1',
          threadId: 'codex-thread-1',
          params: { granted: true },
        },
      },
    ]

    const spawner: CodexProcessSpawner = {
      spawn() {
        return process
      },
    }
    const session = new CodexAppServerSession({
      spawner,
      options: {
        cwd: '/repo',
        model: 'gpt-test',
        modelProvider: 'openai',
        approvalPolicy: 'never',
      },
    })

    const events = await collectEvents(
      session.sendMessage({
        appThreadId: 'jan-thread-1',
        text: 'run the tests',
      })
    )

    expect(events).toEqual(
      expect.arrayContaining([
        {
          type: 'reasoning_part_added',
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'reasoning-1',
          summaryIndex: 0,
        },
        {
          type: 'reasoning_delta',
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'reasoning-1',
          summaryIndex: 0,
          delta: 'summary',
        },
        {
          type: 'reasoning_delta',
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'reasoning-1',
          contentIndex: 1,
          delta: 'details',
        },
        {
          type: 'server_request_resolved',
          requestId: 'request-1',
          threadId: 'codex-thread-1',
          params: expect.objectContaining({ params: { granted: true } }),
        },
        {
          type: 'server_request',
          request: expect.objectContaining({
            id: 'request-1',
            method: 'item/permissions/requestApproval',
          }),
        },
      ])
    )
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'approval_request',
          request: expect.objectContaining({ method: 'item/permissions/requestApproval' }),
        }),
      ])
    )
  })

  it('maps standalone command exec output deltas to process output events', async () => {
    const process = new ScriptedCodexProcess()
    process.turnNotifications = [
      {
        method: 'command/exec/outputDelta',
        params: {
          processId: 'cmd-standalone-1',
          stream: 'stdout',
          deltaBase64: Buffer.from('hello\n').toString('base64'),
          capReached: false,
        },
      },
    ]
    const spawner: CodexProcessSpawner = {
      spawn() {
        return process
      },
    }
    const session = new CodexAppServerSession({
      spawner,
      options: {
        cwd: '/repo',
        model: 'gpt-test',
        modelProvider: 'openai',
        approvalPolicy: 'never',
      },
    })

    const events = await collectEvents(
      session.sendMessage({
        appThreadId: 'jan-thread-1',
        text: 'run command',
      })
    )

    expect(events).toEqual(
      expect.arrayContaining([
        {
          type: 'process_output_delta',
          processHandle: 'cmd-standalone-1',
          stream: 'stdout',
          deltaBase64: Buffer.from('hello\n').toString('base64'),
          capReached: false,
        },
      ])
    )
  })

  it('streams steer notifications until the target sub-thread turn completes', async () => {
    const process = new ScriptedCodexProcess()
    const spawner: CodexProcessSpawner = {
      spawn() {
        return process
      },
    }
    const session = new CodexAppServerSession({
      spawner,
      options: {
        cwd: '/repo',
        model: 'gpt-test',
        modelProvider: 'openai',
        approvalPolicy: 'never',
      },
    })

    const events = await collectEvents(
      session.steerThreadWithEvents('codex-sub-9', 'focus on tests')
    )

    expect(process.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'turn/steer',
          params: expect.objectContaining({
            threadId: 'codex-sub-9',
            input: [{ type: 'text', text: 'focus on tests', text_elements: [] }],
          }),
        }),
      ])
    )
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'assistant_delta',
          threadId: 'codex-sub-9',
          delta: 'steered response',
        }),
        expect.objectContaining({
          type: 'turn_completed',
          threadId: 'codex-sub-9',
        }),
      ])
    )
  })
})

function nextWithTimeout(iterator: AsyncGenerator<unknown>, timeoutMs = 100) {
  return Promise.race([
    iterator.next(),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for next Codex event')), timeoutMs)
    }),
  ])
}

async function collectEvents(iterator: AsyncGenerator<unknown>) {
  const events = []
  for await (const event of iterator) {
    events.push(event)
  }
  return events
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

describe('Codex app-server notification parity events', () => {
  it('maps plan, diff, model, moderation, and auto-approval notifications into typed events', async () => {
    const process = new ScriptedCodexProcess()
    process.turnNotifications = [
      {
        method: 'turn/diff/updated',
        params: { threadId: 'codex-thread-1', turnId: 'turn-1', diff: { files: [] } },
      },
      {
        method: 'turn/plan/updated',
        params: { threadId: 'codex-thread-1', turnId: 'turn-1', plan: [{ step: 'inspect' }] },
      },
      {
        method: 'model/rerouted',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          fromModel: 'gpt-5-mini',
          toModel: 'gpt-5',
          reason: 'capacity',
        },
      },
      {
        method: 'model/verification',
        params: { threadId: 'codex-thread-1', turnId: 'turn-1', status: 'verified' },
      },
      {
        method: 'turn/moderationMetadata',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          metadata: { flagged: false },
        },
      },
      {
        method: 'item/autoApprovalReview/completed',
        params: { threadId: 'codex-thread-1', turnId: 'turn-1', itemId: 'command-1' },
      },
    ]
    const spawner: CodexProcessSpawner = {
      spawn(command, args, options) {
        process.spawnArgs = [command, ...args]
        process.spawnEnv = options.env
        process.spawnCwd = options.cwd
        return process
      },
    }
    const session = new CodexAppServerSession({
      spawner,
      options: {
        codexBinaryPath: '/Applications/Codex.app/Contents/Resources/codex',
        codexHome: '/repo/.jan/codex-home',
        cwd: '/repo',
        model: 'gpt-test',
        modelProvider: 'openai',
        approvalPolicy: 'never',
      },
    })

    await session.initialize()

    const events: unknown[] = []
    for await (const event of session.sendMessage({
      appThreadId: 'jan-thread-1',
      text: 'exercise parity events',
    })) {
      events.push(event)
    }

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'turn_diff_updated', threadId: 'codex-thread-1', turnId: 'turn-1' }),
        expect.objectContaining({ type: 'turn_plan_updated', threadId: 'codex-thread-1', turnId: 'turn-1' }),
        expect.objectContaining({
          type: 'model_rerouted',
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          fromModel: 'gpt-5-mini',
          toModel: 'gpt-5',
        }),
        expect.objectContaining({ type: 'model_verification', threadId: 'codex-thread-1', status: 'verified' }),
        expect.objectContaining({ type: 'turn_moderation_metadata', threadId: 'codex-thread-1', turnId: 'turn-1' }),
        expect.objectContaining({
          type: 'auto_approval_review_event',
          method: 'item/autoApprovalReview/completed',
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'command-1',
        }),
      ])
    )
  })
})
