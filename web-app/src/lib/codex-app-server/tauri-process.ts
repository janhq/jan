import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { CodexProcess, CodexProcessExit, Unsubscribe } from './types'
import type { CodexProcessSpawner, CodexSpawnOptions } from './process-manager'
import { useCodexAppServerRuntime } from '@/stores/codex-app-server-runtime-store'

type TauriCodexLinePayload = {
  sessionId: string
  line: string
}

type TauriCodexExitPayload = {
  sessionId: string
  code?: number | null
  signal?: string | null
}

type TauriCodexProcessInfo = {
  sessionId: string
  pid: number
}

type TauriCodexProcessSpawnerOptions = {
  sessionIdFactory?: () => string
  configToml?: string
  agentsMd?: string
  customAgents?: any[]
}

export class TauriCodexProcess implements CodexProcess {
  private readonly stdoutListeners = new Set<(line: string) => void>()
  private readonly stderrListeners = new Set<(line: string) => void>()
  private readonly exitListeners = new Set<(exit: CodexProcessExit) => void>()
  private readonly unlisten: Unsubscribe[]

  constructor(
    readonly sessionId: string,
    private processPid: number,
    unlisten: Unsubscribe[]
  ) {
    this.unlisten = unlisten
  }

  get pid() {
    return this.processPid
  }

  static async start(
    sessionId: string,
    command: string,
    args: string[],
    options: CodexSpawnOptions
  ) {
    const process = new TauriCodexProcess(sessionId, 0, [])
    await process.attachListeners()

    if (
      (options.configToml || options.agentsMd || options.customAgents) &&
      options.codexHome
    ) {
      await invoke('write_codex_app_server_config', {
        codexHome: options.codexHome,
        configToml: options.configToml ?? '',
        agentsMd: options.agentsMd ?? null,
        customAgents: options.customAgents
          ? JSON.stringify(options.customAgents)
          : null,
      })
    }

    const info = await invoke<TauriCodexProcessInfo>('start_codex_app_server', {
      sessionId,
      command,
      args,
      cwd: options.cwd,
      env: compactEnv(options.env),
    })

    process.processPid = info.pid
    appendRuntimeLog(
      sessionId,
      'system',
      `started pid=${info.pid} cwd=${options.cwd ?? ''}`
    )
    return process
  }

  async writeLine(line: string) {
    await invoke('write_codex_app_server_stdin', {
      sessionId: this.sessionId,
      line,
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

  async kill() {
    await invoke('stop_codex_app_server', { sessionId: this.sessionId })
    this.unlisten.forEach((unlisten) => unlisten())
  }

  private async attachListeners() {
    const stdout = await listen<TauriCodexLinePayload>(
      'codex-app-server-stdout',
      (event) => {
        if (event.payload.sessionId !== this.sessionId) return
        appendRuntimeLog(this.sessionId, 'stdout', event.payload.line)
        this.stdoutListeners.forEach((callback) => callback(event.payload.line))
      }
    )
    const stderr = await listen<TauriCodexLinePayload>(
      'codex-app-server-stderr',
      (event) => {
        if (event.payload.sessionId !== this.sessionId) return
        appendRuntimeLog(this.sessionId, 'stderr', event.payload.line)
        this.stderrListeners.forEach((callback) => callback(event.payload.line))
      }
    )
    const exit = await listen<TauriCodexExitPayload>(
      'codex-app-server-exit',
      (event) => {
        if (event.payload.sessionId !== this.sessionId) return
        appendRuntimeLog(
          this.sessionId,
          'system',
          `exited code=${event.payload.code ?? 'null'} signal=${event.payload.signal ?? 'null'}`
        )
        this.exitListeners.forEach((callback) =>
          callback({
            code: event.payload.code ?? null,
            signal: event.payload.signal ?? null,
          })
        )
        this.unlisten.forEach((unlisten) => unlisten())
      }
    )

    this.unlisten.push(stdout, stderr, exit)
    return this.unlisten
  }
}

export class TauriCodexProcessSpawner implements CodexProcessSpawner {
  constructor(private readonly options: TauriCodexProcessSpawnerOptions = {}) {}

  spawn(command: string, args: string[], options: CodexSpawnOptions) {
    return TauriCodexProcess.start(this.createSessionId(), command, args, {
      ...options,
      configToml: options.configToml ?? this.options.configToml,
      agentsMd: options.agentsMd ?? this.options.agentsMd,
      customAgents: options.customAgents ?? this.options.customAgents,
    })
  }

  private createSessionId() {
    if (this.options.sessionIdFactory) return this.options.sessionIdFactory()
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `codex-${crypto.randomUUID()}`
    }
    return `codex-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

const compactEnv = (env: Record<string, string | undefined>) =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )

const appendRuntimeLog = (
  sessionId: string,
  stream: 'stdout' | 'stderr' | 'system',
  line: string
) => {
  useCodexAppServerRuntime.getState().appendLog({
    sessionId,
    stream,
    line,
    timestamp: Date.now(),
  })
}
