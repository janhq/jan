import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TauriCodexProcessSpawner } from '../tauri-process'

const invoke = vi.hoisted(() => vi.fn())
const listeners = vi.hoisted(
  () => new Map<string, Array<(event: { payload: unknown }) => void>>()
)

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    async (event: string, callback: (event: { payload: unknown }) => void) => {
      const callbacks = listeners.get(event) ?? []
      callbacks.push(callback)
      listeners.set(event, callbacks)
      return () => {
        const current = listeners.get(event) ?? []
        listeners.set(
          event,
          current.filter((item) => item !== callback)
        )
      }
    }
  ),
}))

const emitTauriEvent = (event: string, payload: unknown) => {
  for (const callback of listeners.get(event) ?? []) {
    callback({ payload })
  }
}

describe('TauriCodexProcessSpawner', () => {
  beforeEach(() => {
    invoke.mockReset()
    listeners.clear()
    invoke.mockResolvedValue({ sessionId: 'codex-session-1', pid: 42 })
  })

  it('writes isolated config, starts app-server, and routes process lines', async () => {
    const spawner = new TauriCodexProcessSpawner({
      sessionIdFactory: () => 'codex-session-1',
      configToml: 'model = "gpt-test"',
    })

    const process = await spawner.spawn('/codex', ['app-server', '--stdio'], {
      cwd: '/repo',
      env: {
        CODEX_HOME: '/repo/.jan/codex-home',
        OPENAI_API_KEY: 'test',
        UNUSED: undefined,
      },
      codexHome: '/repo/.jan/codex-home',
      configToml: 'model = "gpt-test"',
    })
    const stdout = vi.fn()
    const stderr = vi.fn()
    process.onStdoutLine(stdout)
    process.onStderrLine(stderr)

    expect(invoke).toHaveBeenNthCalledWith(1, 'write_codex_app_server_config', {
      codexHome: '/repo/.jan/codex-home',
      configToml: 'model = "gpt-test"',
      agentsMd: null,
      customAgents: null,
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'start_codex_app_server', {
      sessionId: 'codex-session-1',
      command: '/codex',
      args: ['app-server', '--stdio'],
      cwd: '/repo',
      env: {
        CODEX_HOME: '/repo/.jan/codex-home',
        OPENAI_API_KEY: 'test',
      },
    })

    emitTauriEvent('codex-app-server-stdout', {
      sessionId: 'codex-session-1',
      line: '{"id":1,"result":{}}',
    })
    emitTauriEvent('codex-app-server-stderr', {
      sessionId: 'other-session',
      line: 'ignore',
    })
    emitTauriEvent('codex-app-server-stderr', {
      sessionId: 'codex-session-1',
      line: 'log line',
    })

    expect(stdout).toHaveBeenCalledWith('{"id":1,"result":{}}')
    expect(stderr).toHaveBeenCalledWith('log line')

    await process.writeLine('{"method":"initialized"}')
    await process.kill()

    expect(invoke).toHaveBeenCalledWith('write_codex_app_server_stdin', {
      sessionId: 'codex-session-1',
      line: '{"method":"initialized"}',
    })
    expect(invoke).toHaveBeenCalledWith('stop_codex_app_server', {
      sessionId: 'codex-session-1',
    })
  })
})
