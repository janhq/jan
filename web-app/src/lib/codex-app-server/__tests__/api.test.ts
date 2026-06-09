import { describe, expect, it } from 'vitest'
import { startCodexSession } from '../api'
import type { CodexProcess, CodexProcessExit, Unsubscribe } from '../types'
import type { CodexProcessSpawner } from '../process-manager'

class ScriptedCodexProcess implements CodexProcess {
  writes: unknown[] = []

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

  private respondToClientMessage(message: { id?: number | string; method?: string; params?: unknown }) {
    if (message.method === 'initialize') {
      this.emit({ id: message.id, result: { userAgent: 'codex-test' } })
    }

    if (message.method === 'thread/start') {
      this.emit({
        id: message.id,
        result: { thread: { id: 'codex-thread-1' } },
      })
    }

    if (message.method === 'turn/start') {
      this.emit({ id: message.id, result: { turn: { id: 'turn-1' } } })
      this.emit({
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'assistant-1',
          delta: 'hello',
        },
      })
      this.emit({
        id: 'approval-1',
        method: 'item/commandExecution/requestApproval',
        params: { command: 'pwd' },
      })
      this.emit({
        method: 'turn/completed',
        params: {
          threadId: 'codex-thread-1',
          turn: { id: 'turn-1', status: 'completed' },
        },
      })
    }

    if (message.method === 'turn/interrupt') {
      this.emit({ id: message.id, result: { interrupted: true } })
    }
  }

  private emit(value: unknown) {
    const line = JSON.stringify(value)
    this.stdoutListeners.forEach((callback) => callback(line))
  }
}

describe('Codex app-server integration API', () => {
  it('hides session internals behind start/send/approve/interrupt/shutdown methods', async () => {
    const process = new ScriptedCodexProcess()
    const spawner: CodexProcessSpawner = {
      spawn() {
        return process
      },
    }

    const client = await startCodexSession({
      spawner,
      options: {
        cwd: '/repo',
        model: 'gpt-test',
        modelProvider: 'openai',
        approvalPolicy: 'on-request',
      },
    })

    const events = []
    for await (const event of client.sendToCodex('jan-thread-1', 'say hello', {
      clientUserMessageId: 'user-message-1',
    })) {
      events.push(event)
    }

    client.approveAction('approval-1', { decision: 'approved' })
    await client.interruptTurn('jan-thread-1')
    await client.shutdownCodex()

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'thread_started', threadId: 'codex-thread-1' }),
        expect.objectContaining({ type: 'assistant_delta', delta: 'hello' }),
        expect.objectContaining({
          type: 'approval_request',
          request: expect.objectContaining({ id: 'approval-1' }),
        }),
        expect.objectContaining({ type: 'turn_completed', turnId: 'turn-1' }),
      ])
    )
    expect(process.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'initialize' }),
        expect.objectContaining({ method: 'initialized' }),
        expect.objectContaining({ method: 'thread/start' }),
        expect.objectContaining({
          method: 'turn/start',
          params: expect.objectContaining({
            clientUserMessageId: 'user-message-1',
            input: [{ type: 'text', text: 'say hello', text_elements: [] }],
          }),
        }),
        { id: 'approval-1', result: { decision: 'approved' } },
        expect.objectContaining({ method: 'turn/interrupt' }),
      ])
    )
  })
})
