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
  transport?: 'app-server' | 'proto'
  configToml?: string
  mcpRefreshConfig?: {
    mcp_servers: unknown
    mcp_oauth_credentials_store_mode: unknown
  }
  cwd?: string
  model?: string
  modelProvider?: string
  profile?: string
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never'
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  serviceName?: string
  env?: Record<string, string | undefined>
  /** AGENTS.md content to write for this session's Codex (global for the codexHome). Codex will auto-discover and use as instructions. */
  agentsMd?: string
  // Subagent controls for Codex engine
  subagentMaxThreads?: number
  subagentMaxDepth?: number
  // New permission profile name (emits default_permissions and can be used with [permissions.xxx] in full config)
  permissionProfile?: string
  /** Extra directories to grant write access (maps to --add-dir / extra roots for Codex engine). */
  addDirs?: string[]
  /** Custom sub-agents defined for this profile (written as TOML in codexHome/agents/ for Codex to load). */
  customAgents?: Array<{
    name: string
    description: string
    developer_instructions: string
    model?: string
    sandbox_mode?: string
  }>
  /** Raw advanced config TOML for hooks/rules/skills/plugins and other sections (appended to generated config.toml). */
  advancedConfigSnippet?: string
}

export type CodexThreadMapping = {
  appThreadId: string
  codexThreadId?: string
  activeTurnId?: string
  loadedGeneration?: number
}

export type CodexAppServerEvent =
  | { type: 'status'; message: string }
  | {
      type: 'thread_started'
      appThreadId: string
      threadId: string
      thread: unknown
    }
  | { type: 'turn_started'; threadId: string; turnId: string; turn: unknown }
  | {
      type: 'assistant_delta'
      threadId: string
      turnId: string
      itemId: string
      delta: string
    }
  | { type: 'turn_completed'; threadId: string; turnId: string; turn: unknown }
  | {
      type: 'item_started'
      threadId?: string
      turnId?: string
      itemId?: string
      item: unknown
    }
  | {
      type: 'item_completed'
      threadId?: string
      turnId?: string
      itemId?: string
      item: unknown
    }
  | { type: 'thread_status'; threadId: string; status: unknown }
  | {
      type: 'thread_settings_updated'
      threadId: string
      threadSettings: unknown
    }
  | {
      type: 'thread_archived'
      threadId: string
      thread: unknown
    }
  | {
      type: 'thread_unarchived'
      threadId: string
      thread: unknown
    }
  | {
      type: 'thread_name_updated'
      threadId: string
      name: string
    }
  | { type: 'thread_closed'; threadId: string }
  | {
      type: 'thread_goal_updated'
      threadId: string
      goal: unknown
    }
  | { type: 'thread_goal_cleared'; threadId: string }
  | {
      type: 'token_usage'
      threadId: string
      turnId?: string
      tokenUsage: unknown
    }
  | {
      type: 'plan_delta'
      threadId: string
      turnId: string
      itemId: string
      delta: string
    }
  | {
      type: 'reasoning_delta'
      threadId: string
      turnId: string
      itemId: string
      delta: string
      summaryIndex?: number
      contentIndex?: number
    }
  | {
      type: 'reasoning_part_added'
      threadId: string
      turnId: string
      itemId: string
      summaryIndex?: number
      contentIndex?: number
    }
  | {
      type: 'command_output_delta'
      threadId: string
      turnId: string
      itemId: string
      delta: string
    }
  | {
      type: 'file_change_delta'
      threadId: string
      turnId: string
      itemId: string
      delta: string
    }
  | {
      type: 'file_change_patch'
      threadId: string
      turnId: string
      itemId: string
      patch: unknown
    }
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
  | {
      type: 'fs_changed'
      watchId: string
      changedPaths: string[]
    }
  | {
      type: 'account_login_completed'
      loginId?: string
      success: boolean
      error?: unknown
      params: unknown
    }
  | {
      type: 'account_updated'
      authMode: string | null
      planType: string | null
      params: unknown
    }
  | {
      type: 'account_rate_limits_updated'
      rateLimits: unknown
      individualLimit?: unknown
      params: unknown
    }
  | {
      type: 'mcp_oauth_login_completed'
      name: string
      success: boolean
      error?: unknown
      params: unknown
    }
  | {
      type: 'mcp_startup_status_updated'
      threadId?: string
      name: string
      status: string
      error?: unknown
      params: unknown
    }
  | {
      type: 'remote_control_status_changed'
      status: string
      serverName?: string
      environmentId?: string
      params: unknown
    }
  | {
      type: 'turn_diff_updated'
      threadId?: string
      turnId?: string
      diff?: unknown
      params: unknown
    }
  | {
      type: 'turn_plan_updated'
      threadId?: string
      turnId?: string
      plan?: unknown
      params: unknown
    }
  | {
      type: 'model_rerouted'
      threadId?: string
      turnId?: string
      fromModel?: string
      toModel?: string
      reason?: unknown
      params: unknown
    }
  | {
      type: 'model_verification'
      threadId?: string
      turnId?: string
      status?: string
      params: unknown
    }
  | {
      type: 'turn_moderation_metadata'
      threadId?: string
      turnId?: string
      metadata?: unknown
      params: unknown
    }
  | {
      type: 'auto_approval_review_event'
      method: string
      threadId?: string
      turnId?: string
      itemId?: string
      params: unknown
    }
  | { type: 'approval_request'; request: CodexWireServerRequest }
  | { type: 'server_request'; request: CodexWireServerRequest }
  | {
      type: 'server_request_resolved'
      requestId: string | number
      params?: unknown
      threadId?: string
    }
  | { type: 'warning'; message: string; threadId?: string }
  | {
      type: 'notification'
      method: string
      params?: unknown
      threadId?: string
    }
  | {
      type: 'skills_changed'
      threadId?: string
      skills?: unknown
      changed?: unknown
    }
  | { type: 'plugins_changed'; threadId?: string; plugins?: unknown; changed?: unknown }
  | { type: 'hooks_changed'; threadId?: string; hooks?: unknown }
  | { type: 'error'; error: Error }
