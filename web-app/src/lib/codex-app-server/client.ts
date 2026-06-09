import { buildThreadStartParams } from './config'
import {
  CodexAppServerProcessManager,
  type CodexProcessSpawner,
} from './process-manager'
import type {
  CodexAppServerEvent,
  CodexInitializeResult,
  CodexSessionOptions,
  CodexThreadMapping,
  CodexWireNotification,
  CodexWireServerRequest,
  Unsubscribe,
} from './types'

type CodexAppServerSessionParams = {
  spawner: CodexProcessSpawner
  options: CodexSessionOptions
}

type SendMessageParams = {
  appThreadId: string
  text: string
  cwd?: string
  clientUserMessageId?: string
}

type ThreadStartResponse = {
  thread?: {
    id?: string
  }
}

type ThreadResumeResponse = ThreadStartResponse

type TurnStartResponse = {
  turn?: {
    id?: string
  }
}

export class CodexAppServerSession {
  private readonly manager: CodexAppServerProcessManager
  private readonly mappings = new Map<string, CodexThreadMapping>()
  private readonly threadPayloads = new Map<string, unknown>()

  constructor(private readonly params: CodexAppServerSessionParams) {
    this.manager = new CodexAppServerProcessManager(params.spawner, params.options)
  }

  initialize(): Promise<CodexInitializeResult> {
    return this.manager.initialize()
  }

  async *sendMessage(params: SendMessageParams): AsyncGenerator<CodexAppServerEvent> {
    await this.initialize()

    const mapping = await this.ensureThread(params.appThreadId)
    if (!mapping.codexThreadId) {
      throw new Error(`Codex thread was not created for Jan thread ${params.appThreadId}`)
    }

    const queue = createEventQueue()
    const unsubscriptions: Unsubscribe[] = [
      this.manager.rpc.onNotification((message) => {
        const event = mapNotificationToEvent(message)
        if (!event) return
        if ('threadId' in event && event.threadId !== mapping.codexThreadId) return
        queue.push(event)
      }),
      this.manager.rpc.onServerRequest((request) => {
        queue.push(mapServerRequestToEvent(request))
      }),
      this.manager.rpc.onError((error) => queue.push({ type: 'error', error })),
    ]

    yield {
      type: 'thread_started',
      appThreadId: params.appThreadId,
      threadId: mapping.codexThreadId,
      thread: this.threadPayloads.get(params.appThreadId) ?? { id: mapping.codexThreadId },
    }

    try {
      const response = await this.manager.rpc.request<TurnStartResponse>('turn/start', {
        threadId: mapping.codexThreadId,
        clientUserMessageId: params.clientUserMessageId ?? null,
        input: [{ type: 'text', text: params.text, text_elements: [] }],
        cwd: params.cwd ?? this.params.options.cwd ?? null,
        approvalPolicy: this.params.options.approvalPolicy ?? null,
        model: this.params.options.model ?? null,
      })

      mapping.activeTurnId = response.turn?.id

      let completed = false
      while (!completed) {
        const event = await queue.next()
        yield event
        completed = event.type === 'turn_completed' || event.type === 'error'
      }
    } finally {
      unsubscriptions.forEach((unsubscribe) => unsubscribe())
    }
  }

  interruptTurn(appThreadId: string) {
    const mapping = this.mappings.get(appThreadId)
    if (!mapping?.codexThreadId || !mapping.activeTurnId) {
      return Promise.resolve(null)
    }

    return this.manager.rpc.request('turn/interrupt', {
      threadId: mapping.codexThreadId,
      turnId: mapping.activeTurnId,
    })
  }

  respondToServerRequest(requestId: string | number, result: unknown) {
    this.manager.rpc.respond(requestId, result)
  }

  shutdown() {
    return this.manager.shutdown()
  }

  restart() {
    return this.manager.restart()
  }

  private async ensureThread(appThreadId: string) {
    const existing = this.mappings.get(appThreadId)
    if (
      existing?.codexThreadId &&
      existing.loadedGeneration === this.manager.generation
    ) {
      return existing
    }

    if (existing?.codexThreadId) {
      const response = await this.manager.rpc.request<ThreadResumeResponse>('thread/resume', {
        threadId: existing.codexThreadId,
        ...buildThreadStartParams(this.params.options),
      })
      existing.loadedGeneration = this.manager.generation
      this.threadPayloads.set(appThreadId, response.thread)
      return existing
    }

    const response = await this.manager.rpc.request<ThreadStartResponse>('thread/start', {
      ...buildThreadStartParams(this.params.options),
      ephemeral: false,
    })
    const codexThreadId = response.thread?.id
    if (!codexThreadId) {
      throw new Error('Codex app-server did not return a thread id')
    }

    const mapping: CodexThreadMapping = {
      appThreadId,
      codexThreadId,
      loadedGeneration: this.manager.generation,
    }
    this.mappings.set(appThreadId, mapping)
    this.threadPayloads.set(appThreadId, response.thread)
    return mapping
  }
}

const mapNotificationToEvent = (
  message: CodexWireNotification
): CodexAppServerEvent | null => {
  const params = isRecord(message.params) ? message.params : {}

  if (message.method === 'turn/started') {
    const turn = isRecord(params.turn) ? params.turn : {}
    return {
      type: 'turn_started',
      threadId: String(params.threadId),
      turnId: String(turn.id),
      turn,
    }
  }

  if (message.method === 'thread/status/changed') {
    return {
      type: 'thread_status',
      threadId: String(params.threadId),
      status: params.status,
    }
  }

  if (message.method === 'thread/tokenUsage/updated') {
    return {
      type: 'token_usage',
      threadId: String(params.threadId),
      turnId: stringValue(params.turnId),
      tokenUsage: params.tokenUsage,
    }
  }

  if (message.method === 'item/started') {
    const item = isRecord(params.item) ? params.item : {}
    return {
      type: 'item_started',
      threadId: stringValue(params.threadId),
      turnId: stringValue(params.turnId),
      itemId: stringValue(item.id),
      item,
    }
  }

  if (message.method === 'item/completed') {
    const item = isRecord(params.item) ? params.item : {}
    return {
      type: 'item_completed',
      threadId: stringValue(params.threadId),
      turnId: stringValue(params.turnId),
      itemId: stringValue(item.id),
      item,
    }
  }

  if (message.method === 'item/agentMessage/delta') {
    return {
      type: 'assistant_delta',
      threadId: String(params.threadId),
      turnId: String(params.turnId),
      itemId: String(params.itemId),
      delta: String(params.delta ?? ''),
    }
  }

  if (message.method === 'item/plan/delta') {
    return {
      type: 'plan_delta',
      threadId: String(params.threadId),
      turnId: String(params.turnId),
      itemId: String(params.itemId),
      delta: String(params.delta ?? ''),
    }
  }

  if (
    message.method === 'item/reasoning/textDelta' ||
    message.method === 'item/reasoning/summaryTextDelta'
  ) {
    return {
      type: 'reasoning_delta',
      threadId: String(params.threadId),
      turnId: String(params.turnId),
      itemId: String(params.itemId),
      delta: String(params.delta ?? ''),
    }
  }

  if (message.method === 'turn/completed') {
    const turn = isRecord(params.turn) ? params.turn : {}
    return {
      type: 'turn_completed',
      threadId: String(params.threadId),
      turnId: String(turn.id),
      turn,
    }
  }

  if (message.method === 'error') {
    const error = isRecord(params.error) ? params.error : params
    return {
      type: 'error',
      error: new Error(String(error.message ?? 'Codex app-server turn failed')),
    }
  }

  if (message.method === 'item/commandExecution/outputDelta') {
    return {
      type: 'command_output_delta',
      threadId: String(params.threadId),
      turnId: String(params.turnId),
      itemId: String(params.itemId),
      delta: String(params.delta ?? ''),
    }
  }

  if (message.method === 'item/commandExecution/terminalInteraction') {
    return {
      type: 'terminal_interaction',
      threadId: String(params.threadId),
      turnId: String(params.turnId),
      itemId: String(params.itemId),
      processId: String(params.processId),
      stdin: String(params.stdin ?? ''),
    }
  }

  if (message.method === 'item/fileChange/outputDelta') {
    return {
      type: 'file_change_delta',
      threadId: String(params.threadId),
      turnId: String(params.turnId),
      itemId: String(params.itemId),
      delta: String(params.delta ?? ''),
    }
  }

  if (message.method === 'item/fileChange/patchUpdated') {
    return {
      type: 'file_change_patch',
      threadId: String(params.threadId),
      turnId: String(params.turnId),
      itemId: String(params.itemId),
      patch: params.patch,
    }
  }

  if (message.method === 'process/outputDelta') {
    return {
      type: 'process_output_delta',
      processHandle: String(params.processHandle),
      stream: String(params.stream),
      deltaBase64: String(params.deltaBase64 ?? ''),
      capReached: Boolean(params.capReached),
    }
  }

  if (message.method === 'process/exited') {
    return {
      type: 'process_exited',
      processHandle: String(params.processHandle),
      exitCode: Number(params.exitCode ?? 0),
      stdout: String(params.stdout ?? ''),
      stderr: String(params.stderr ?? ''),
    }
  }

  if (message.method === 'warning') {
    return {
      type: 'warning',
      message: String(params.message ?? 'Codex app-server warning'),
      threadId: stringValue(params.threadId),
    }
  }

  return {
    type: 'notification',
    method: message.method,
    params: message.params,
    threadId: stringValue(params.threadId),
  }
}

const mapServerRequestToEvent = (
  request: CodexWireServerRequest
): CodexAppServerEvent => {
  if (isApprovalRequestMethod(request.method)) {
    return { type: 'approval_request', request }
  }
  return { type: 'server_request', request }
}

const isApprovalRequestMethod = (method: string) =>
  method.includes('requestApproval') ||
  method === 'execCommandApproval' ||
  method === 'applyPatchApproval'

const createEventQueue = () => {
  const events: CodexAppServerEvent[] = []
  const waiters: Array<(event: CodexAppServerEvent) => void> = []

  return {
    push(event: CodexAppServerEvent) {
      const waiter = waiters.shift()
      if (waiter) {
        waiter(event)
        return
      }
      events.push(event)
    },
    next() {
      const event = events.shift()
      if (event) return Promise.resolve(event)
      return new Promise<CodexAppServerEvent>((resolve) => waiters.push(resolve))
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.length > 0 ? value : undefined
