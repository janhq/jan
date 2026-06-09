import { describe, expect, it } from 'vitest'
import { CodexAppServerProcessManager, type CodexProcessSpawner } from '../process-manager'
import type { CodexProcess, CodexProcessExit, Unsubscribe } from '../types'

class InitOnlyProcess implements CodexProcess {
  writes: unknown[] = []
  killed = false

  private stdoutListeners = new Set<(line: string) => void>()
  private stderrListeners = new Set<(line: string) => void>()
  private exitListeners = new Set<(exit: CodexProcessExit) => void>()

  constructor(private readonly mode: 'fail' | 'success') {}

  writeLine(line: string) {
    const message = JSON.parse(line)
    this.writes.push(message)

    if (message.method !== 'initialize') return
    if (this.mode === 'fail') {
      this.emit({
        id: message.id,
        error: { message: 'provider configuration failed' },
      })
      return
    }

    this.emit({
      id: message.id,
      result: { userAgent: 'codex-test', codexHome: '/tmp/codex' },
    })
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
    this.killed = true
    this.exitListeners.forEach((callback) => callback({ code: 0, signal: null }))
  }

  private emit(value: unknown) {
    const line = JSON.stringify(value)
    this.stdoutListeners.forEach((callback) => callback(line))
  }
}

describe('CodexAppServerProcessManager', () => {
  it('passes agentsMd and customAgents to the process spawner', async () => {
    const spawnedOptions: unknown[] = []
    const process = new InitOnlyProcess('success')
    const spawner: CodexProcessSpawner = {
      spawn(_command, _args, options) {
        spawnedOptions.push(options)
        return process
      },
    }
    const manager = new CodexAppServerProcessManager(spawner, {
      cwd: '/repo',
      model: 'gpt-test',
      modelProvider: 'openai',
      agentsMd: '# AGENTS\nBe careful.',
      customAgents: [
        {
          name: 'helper',
          description: 'Helper agent',
          developer_instructions: 'Assist.',
        },
      ],
      configToml: 'model = "gpt-test"',
      codexHome: '/tmp/codex-home',
    })

    await manager.initialize()

    expect(spawnedOptions[0]).toEqual(
      expect.objectContaining({
        agentsMd: '# AGENTS\nBe careful.',
        customAgents: [
          expect.objectContaining({ name: 'helper' }),
        ],
        configToml: 'model = "gpt-test"',
        codexHome: '/tmp/codex-home',
      })
    )

    const initializeRequest = (process.writes as Array<{ method?: string; params?: { capabilities?: Record<string, boolean> } }>).find(
      (write) => write.method === 'initialize'
    )
    expect(initializeRequest?.params?.capabilities).toEqual(
      expect.objectContaining({
        hostApprovals: true,
        hostMcpCuration: true,
        hostGitReviewPanel: true,
        hostWorkspaceManagement: true,
        hostSubagentInspector: true,
      })
    )
  })

  it('cleans up a failed initialization and allows a later initialize retry', async () => {
    const failedProcess = new InitOnlyProcess('fail')
    const successfulProcess = new InitOnlyProcess('success')
    const spawns: InitOnlyProcess[] = [failedProcess, successfulProcess]
    const spawner: CodexProcessSpawner = {
      spawn() {
        const process = spawns.shift()
        if (!process) throw new Error('unexpected extra spawn')
        return process
      },
    }
    const manager = new CodexAppServerProcessManager(spawner, {
      cwd: '/repo',
      model: 'gpt-test',
      modelProvider: 'openai',
    })

    await expect(manager.initialize()).rejects.toThrow('provider configuration failed')
    expect(failedProcess.killed).toBe(true)
    expect(manager.isRunning).toBe(false)

    await expect(manager.initialize()).resolves.toEqual({
      userAgent: 'codex-test',
      codexHome: '/tmp/codex',
    })
    expect(successfulProcess.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'initialize' }),
        expect.objectContaining({ method: 'initialized' }),
      ])
    )
  })
})
