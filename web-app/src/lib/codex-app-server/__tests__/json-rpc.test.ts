import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CodexJsonRpcClient,
  type CodexProcess,
  type CodexProcessExit,
  type Unsubscribe,
} from '../json-rpc'

class FakeCodexProcess implements CodexProcess {
  lines: string[] = []
  killed = false

  private stdoutListeners = new Set<(line: string) => void>()
  private stderrListeners = new Set<(line: string) => void>()
  private exitListeners = new Set<(exit: CodexProcessExit) => void>()

  writeLine(line: string) {
    this.lines.push(line)
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

  emitStdout(value: unknown) {
    const line = typeof value === 'string' ? value : JSON.stringify(value)
    this.stdoutListeners.forEach((callback) => callback(line))
  }

  emitStderr(value: unknown) {
    const line = typeof value === 'string' ? value : JSON.stringify(value)
    this.stderrListeners.forEach((callback) => callback(line))
  }

  emitExit(exit: CodexProcessExit = { code: 0 }) {
    this.exitListeners.forEach((callback) => callback(exit))
  }

  kill() {
    this.killed = true
  }
}

describe('CodexJsonRpcClient', () => {
  let process: FakeCodexProcess
  let client: CodexJsonRpcClient

  beforeEach(() => {
    vi.useRealTimers()
    process = new FakeCodexProcess()
    client = new CodexJsonRpcClient(process, { requestTimeoutMs: 1000 })
  })

  it('writes app-server requests without the JSON-RPC version field', async () => {
    const promise = client.request('initialize', {
      clientInfo: { name: 'jan', title: 'Jan', version: '0.0.0-test' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    })

    const outbound = JSON.parse(process.lines[0])
    expect(outbound).toMatchObject({ method: 'initialize', id: 1 })
    expect(outbound.jsonrpc).toBeUndefined()

    process.emitStdout({ id: outbound.id, result: { userAgent: 'codex-test' } })

    await expect(promise).resolves.toEqual({ userAgent: 'codex-test' })
  })

  it('emits notifications and server requests separately', () => {
    const notification = vi.fn()
    const serverRequest = vi.fn()

    client.onNotification(notification)
    client.onServerRequest(serverRequest)

    process.emitStdout({ method: 'turn/completed', params: { threadId: 't1' } })
    process.emitStdout({
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 't1', turnId: 'turn-1' },
    })

    expect(notification).toHaveBeenCalledWith({
      method: 'turn/completed',
      params: { threadId: 't1' },
    })
    expect(serverRequest).toHaveBeenCalledWith({
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 't1', turnId: 'turn-1' },
    })
  })

  it('reports malformed stdout lines without throwing', () => {
    const error = vi.fn()
    client.onError(error)

    process.emitStdout('{bad json')

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Malformed Codex app-server message'),
      })
    )
  })

  it('surfaces stderr warning logs without treating them as fatal errors', () => {
    const notification = vi.fn()
    const error = vi.fn()
    client.onNotification(notification)
    client.onError(error)

    process.emitStderr({
      level: 'WARN',
      fields: { message: 'Unknown model mock-model is used.' },
    })

    expect(error).not.toHaveBeenCalled()
    expect(notification).toHaveBeenCalledWith({
      method: 'warning',
      params: {
        threadId: null,
        message: 'Unknown model mock-model is used.',
      },
    })
  })

  it('reports stderr error logs as fatal client errors', () => {
    const error = vi.fn()
    client.onError(error)

    process.emitStderr({
      level: 'ERROR',
      fields: { message: 'provider configuration failed' },
    })

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('provider configuration failed'),
      })
    )
  })

  it('rejects pending requests when the process exits', async () => {
    const promise = client.request('thread/start', { cwd: '/repo' })

    process.emitExit({ code: 1, signal: null })

    await expect(promise).rejects.toThrow('Codex app-server exited')
  })

  it('writes responses for app-server initiated requests', () => {
    client.respond('approval-1', { decision: 'decline' })

    expect(JSON.parse(process.lines[0])).toEqual({
      id: 'approval-1',
      result: { decision: 'decline' },
    })
  })
})
