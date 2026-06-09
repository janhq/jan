import type {
  CodexProcess,
  CodexProcessExit,
  CodexRequestId,
  CodexWireNotification,
  CodexWireResponse,
  CodexWireServerRequest,
  Unsubscribe,
} from './types'

export type {
  CodexProcess,
  CodexProcessExit,
  CodexRequestId,
  CodexWireNotification,
  CodexWireResponse,
  CodexWireServerRequest,
  Unsubscribe,
} from './types'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

type CodexJsonRpcClientOptions = {
  requestTimeoutMs?: number
}

export class CodexJsonRpcClient {
  private nextId = 1
  private readonly pending = new Map<CodexRequestId, PendingRequest>()
  private readonly notificationListeners = new Set<(message: CodexWireNotification) => void>()
  private readonly serverRequestListeners = new Set<(message: CodexWireServerRequest) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private readonly unsubscriptions: Unsubscribe[]
  private readonly requestTimeoutMs: number
  private closed = false

  constructor(
    private readonly process: CodexProcess,
    options: CodexJsonRpcClientOptions = {}
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000
    this.unsubscriptions = [
      this.process.onStdoutLine((line) => this.handleStdoutLine(line)),
      this.process.onStderrLine((line) => this.handleStderrLine(line)),
      this.process.onExit((exit) => this.handleExit(exit)),
    ]
  }

  get isClosed() {
    return this.closed
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('Codex app-server client is closed'))
    }

    const id = this.nextId++
    const message =
      params === undefined
        ? { id, method }
        : {
            id,
            method,
            params,
          }

    const promise = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex app-server request timed out: ${method}`))
      }, this.requestTimeoutMs)

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      })
    })

    void this.process.writeLine(JSON.stringify(message))
    return promise
  }

  notify(method: string, params?: unknown) {
    const message = params === undefined ? { method } : { method, params }
    void this.process.writeLine(JSON.stringify(message))
  }

  respond(id: CodexRequestId, result: unknown) {
    void this.process.writeLine(JSON.stringify({ id, result }))
  }

  respondError(id: CodexRequestId, error: { code?: number; message: string; data?: unknown }) {
    void this.process.writeLine(JSON.stringify({ id, error }))
  }

  onNotification(callback: (message: CodexWireNotification) => void): Unsubscribe {
    this.notificationListeners.add(callback)
    return () => this.notificationListeners.delete(callback)
  }

  onServerRequest(callback: (message: CodexWireServerRequest) => void): Unsubscribe {
    this.serverRequestListeners.add(callback)
    return () => this.serverRequestListeners.delete(callback)
  }

  onError(callback: (error: Error) => void): Unsubscribe {
    this.errorListeners.add(callback)
    return () => this.errorListeners.delete(callback)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.unsubscriptions.forEach((unsubscribe) => unsubscribe())
    this.rejectPending(new Error('Codex app-server client closed'))
  }

  private handleStdoutLine(line: string) {
    if (!line.trim()) return

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      this.emitError(
        new Error(`Malformed Codex app-server message: ${String((error as Error).message)}`)
      )
      return
    }

    if (!isRecord(parsed)) {
      this.emitError(new Error('Malformed Codex app-server message: expected object'))
      return
    }

    if ('id' in parsed && ('result' in parsed || 'error' in parsed) && !('method' in parsed)) {
      this.handleResponse(parsed as CodexWireResponse)
      return
    }

    if ('id' in parsed && typeof parsed.method === 'string') {
      this.serverRequestListeners.forEach((listener) =>
        listener(parsed as CodexWireServerRequest)
      )
      return
    }

    if (typeof parsed.method === 'string') {
      this.notificationListeners.forEach((listener) =>
        listener(parsed as CodexWireNotification)
      )
      return
    }

    this.emitError(new Error('Malformed Codex app-server message: unknown shape'))
  }

  private handleStderrLine(line: string) {
    if (!line.trim()) return
    const log = parseStderrLog(line)
    if (log.level === 'ERROR') {
      this.emitError(new Error(`Codex app-server error: ${log.message}`))
      return
    }

    this.notificationListeners.forEach((listener) =>
      listener({
        method: 'warning',
        params: {
          threadId: null,
          message: log.message,
        },
      })
    )
  }

  private handleResponse(response: CodexWireResponse) {
    const pending = this.pending.get(response.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pending.delete(response.id)

    if (response.error) {
      pending.reject(new Error(response.error.message))
      return
    }

    pending.resolve(response.result)
  }

  private handleExit(exit: CodexProcessExit) {
    this.closed = true
    const error = new Error(
      `Codex app-server exited with code ${exit.code ?? 'null'}${
        exit.signal ? ` and signal ${exit.signal}` : ''
      }`
    )
    this.rejectPending(error)
    this.emitError(error)
  }

  private rejectPending(error: Error) {
    this.pending.forEach((pending) => {
      clearTimeout(pending.timeout)
      pending.reject(error)
    })
    this.pending.clear()
  }

  private emitError(error: Error) {
    this.errorListeners.forEach((listener) => listener(error))
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const parseStderrLog = (line: string) => {
  try {
    const parsed = JSON.parse(line)
    if (isRecord(parsed)) {
      const fields = isRecord(parsed.fields) ? parsed.fields : {}
      return {
        level: String(parsed.level ?? 'WARN').toUpperCase(),
        message: String(fields.message ?? parsed.message ?? line),
      }
    }
  } catch {
    // Plain stderr is still useful process output; process exit handles fatality.
  }

  return {
    level: 'WARN',
    message: line,
  }
}
