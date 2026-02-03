// ============================================================================
// Messages FROM Jan TO OpenCode (stdin)
// ============================================================================

export interface TaskPayload {
  sessionId?: string
  projectPath: string
  prompt: string
  agent?: 'build' | 'plan' | 'explore'
}

export interface PermissionResponsePayload {
  permissionId: string
  action: 'allow_once' | 'allow_always' | 'deny'
  message?: string
}

export interface CancelPayload {
  sessionId?: string
}

export interface InputPayload {
  text: string
}

// ============================================================================
// Messages FROM OpenCode TO Jan (stdout)
// ============================================================================

export type OpenCodeEvent =
  | { type: 'session.started'; sessionId: string }
  | { type: 'step.started'; step: number }
  | { type: 'step.completed'; step: number }
  | { type: 'tool.started'; tool: string; input: unknown }
  | { type: 'tool.completed'; tool: string; output: unknown; title?: string }
  | { type: 'text.delta'; text: string }
  | { type: 'text.complete'; text: string }
  | { type: 'reasoning.delta'; text: string }
  | { type: 'file.changed'; path: string; diff?: string }

export interface ReadyPayload {
  version: string
  projectPath: string
}

export interface PermissionRequestPayload {
  permissionId: string
  sessionId: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
  description?: string
}

export interface ResultPayload {
  sessionId: string
  status: 'completed' | 'cancelled' | 'error'
  summary?: string
  filesChanged?: string[]
  tokensUsed?: number
  error?: string
}

export interface ErrorPayload {
  code: string
  message: string
  details?: unknown
}

export type OpenCodeMessage =
  | { type: 'ready'; id: string; payload: ReadyPayload }
  | { type: 'event'; id: string; payload: { event: OpenCodeEvent } }
  | { type: 'permission_request'; id: string; payload: PermissionRequestPayload }
  | { type: 'result'; id: string; payload: ResultPayload }
  | { type: 'error'; id: string; payload: ErrorPayload }

// ============================================================================
// Task State
// ============================================================================

export type TaskStatus =
  | 'starting'
  | 'ready'
  | 'running'
  | 'waiting_permission'
  | 'completed'
  | 'cancelled'
  | 'error'

export interface OpenCodeTask {
  taskId: string
  sessionId?: string
  projectPath: string
  prompt: string
  agent?: string
  status: TaskStatus
  events: OpenCodeEvent[]
  result?: ResultPayload
  pendingPermission?: PermissionRequestPayload
  error?: ErrorPayload
  createdAt: number
  updatedAt: number
}

// ============================================================================
// Service Interface
// ============================================================================

export interface OpenCodeServiceInterface {
  /**
   * Start a new OpenCode task
   * @param taskId - Optional task ID (will be generated if not provided)
   */
  startTask(params: {
    taskId?: string
    projectPath: string
    prompt: string
    agent?: 'build' | 'plan' | 'explore'
    apiKey?: string
  }): Promise<string>

  /**
   * Cancel a running task
   */
  cancelTask(taskId: string): Promise<void>

  /**
   * Respond to a permission request
   */
  respondToPermission(
    taskId: string,
    permissionId: string,
    action: 'allow_once' | 'allow_always' | 'deny',
    message?: string
  ): Promise<void>

  /**
   * Send user input to a task
   */
  sendInput(taskId: string, text: string): Promise<void>

  /**
   * Check if a task is running
   */
  isTaskRunning(taskId: string): Promise<boolean>

  /**
   * Get count of running tasks
   */
  runningTaskCount(): Promise<number>

  /**
   * Subscribe to events for a specific task
   */
  onEvent(taskId: string, handler: (message: OpenCodeMessage) => void): () => void

  /**
   * Subscribe to status changes for a specific task
   */
  onStatusChange(taskId: string, handler: (status: string) => void): () => void
}
