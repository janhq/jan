export type CodexRequestId = string | number

export type CodexJsonPrimitive = string | number | boolean | null

export type CodexJsonValue =
  | CodexJsonPrimitive
  | CodexJsonValue[]
  | { [key: string]: CodexJsonValue | undefined }

export type CodexJsonObject = { [key: string]: CodexJsonValue | undefined }

export type Unsubscribe = () => void

export type CodexProcessExit = {
  code: number | null
  signal?: string | null
}

export interface CodexProcess {
  writeLine(line: string): void | Promise<void>
  onStdoutLine(callback: (line: string) => void): Unsubscribe
  onStderrLine(callback: (line: string) => void): Unsubscribe
  onExit(callback: (exit: CodexProcessExit) => void): Unsubscribe
  kill(signal?: string): void | Promise<void>
}

export type CodexWireRequest = {
  id: CodexRequestId
  method: string
  params?: unknown
}

export type CodexWireResponse = {
  id: CodexRequestId
  result?: unknown
  error?: {
    code?: number
    message: string
    data?: unknown
  }
}

export type CodexWireNotification = {
  method: string
  params?: unknown
}

export type CodexWireServerRequest = {
  id: CodexRequestId
  method: string
  params?: unknown
}

export type CodexInitializeResult = {
  userAgent: string
  codexHome?: string
  platformFamily?: string
  platformOs?: string
}

export type CodexProviderConfig = {
  id: string
  name?: string
  baseUrl?: string
  apiKeyEnvVar?: string
  wireApi?: 'chat' | 'responses'
}

export type CodexSessionOptions = {
  codexBinaryPath?: string
  codexHome?: string
  configToml?: string
  cwd?: string
  model?: string
  modelProvider?: string
  profile?: string
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never'
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  serviceName?: string
  env?: Record<string, string | undefined>
}

export type CodexThreadMapping = {
  appThreadId: string
  codexThreadId?: string
  activeTurnId?: string
  loadedGeneration?: number
}

export type CodexAppServerEvent =
  | { type: 'status'; message: string }
  | { type: 'thread_started'; appThreadId: string; threadId: string; thread: unknown }
  | { type: 'turn_started'; threadId: string; turnId: string; turn: unknown }
  | {
      type: 'assistant_delta'
      threadId: string
      turnId: string
      itemId: string
      delta: string
    }
  | { type: 'turn_completed'; threadId: string; turnId: string; turn: unknown }
  | { type: 'item_started'; threadId?: string; turnId?: string; itemId?: string; item: unknown }
  | { type: 'item_completed'; threadId?: string; turnId?: string; itemId?: string; item: unknown }
  | { type: 'thread_status'; threadId: string; status: unknown }
  | { type: 'token_usage'; threadId: string; turnId?: string; tokenUsage: unknown }
  | { type: 'plan_delta'; threadId: string; turnId: string; itemId: string; delta: string }
  | { type: 'reasoning_delta'; threadId: string; turnId: string; itemId: string; delta: string }
  | { type: 'command_output_delta'; threadId: string; turnId: string; itemId: string; delta: string }
  | { type: 'file_change_delta'; threadId: string; turnId: string; itemId: string; delta: string }
  | { type: 'file_change_patch'; threadId: string; turnId: string; itemId: string; patch: unknown }
  | {
      type: 'terminal_interaction'
      threadId: string
      turnId: string
      itemId: string
      processId: string
      stdin: string
    }
  | {
      type: 'process_output_delta'
      processHandle: string
      stream: string
      deltaBase64: string
      capReached: boolean
    }
  | {
      type: 'process_exited'
      processHandle: string
      exitCode: number
      stdout: string
      stderr: string
    }
  | { type: 'approval_request'; request: CodexWireServerRequest }
  | { type: 'server_request'; request: CodexWireServerRequest }
  | { type: 'warning'; message: string; threadId?: string }
  | { type: 'notification'; method: string; params?: unknown; threadId?: string }
  | { type: 'error'; error: Error }
