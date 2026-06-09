import type {
  CodexAppServerEvent,
  CodexRequestId,
  CodexWireServerRequest,
} from './types'

export type CodexProtoEvent = {
  id?: string
  msg?: unknown
}

export type CodexProtoEventMapperOptions = {
  appThreadId?: string
}

export class CodexProtoEventMapper {
  private readonly appThreadId?: string
  private threadId?: string
  private activeTurnId?: string

  constructor(options: CodexProtoEventMapperOptions = {}) {
    this.appThreadId = options.appThreadId
  }

  map(value: unknown): CodexAppServerEvent | null {
    if (!isRecord(value)) return null
    const eventId = stringValue(value.id)
    const msg = isRecord(value.msg) ? value.msg : undefined
    if (!msg) return null

    const protoType = stringValue(msg.type)
    if (!protoType) return null

    if (protoType === 'session_configured') {
      const threadId =
        stringValue(msg.thread_id) ??
        stringValue(msg.threadId) ??
        stringValue(msg.session_id) ??
        stringValue(msg.sessionId) ??
        this.appThreadId ??
        eventId ??
        'codex-proto-thread'
      this.threadId = threadId
      return {
        type: 'thread_started',
        appThreadId: this.appThreadId ?? threadId,
        threadId,
        thread: msg,
      }
    }

    if (protoType === 'task_started' || protoType === 'turn_started') {
      const turnId = this.resolveTurnId(msg, eventId)
      this.activeTurnId = turnId
      return {
        type: 'turn_started',
        threadId: this.resolveThreadId(msg),
        turnId,
        turn: msg,
      }
    }

    if (protoType === 'task_complete' || protoType === 'turn_complete') {
      const turnId = this.resolveTurnId(msg, eventId)
      return {
        type: 'turn_completed',
        threadId: this.resolveThreadId(msg),
        turnId,
        turn: msg,
      }
    }

    if (protoType === 'agent_message_content_delta') {
      return {
        type: 'assistant_delta',
        threadId: this.resolveThreadId(msg),
        turnId: this.resolveTurnId(msg, eventId),
        itemId: this.resolveItemId(msg, eventId, 'assistant'),
        delta: String(msg.delta ?? ''),
      }
    }

    if (protoType === 'agent_message') {
      const message = stringValue(msg.message)
      if (!message) return null
      return {
        type: 'assistant_delta',
        threadId: this.resolveThreadId(msg),
        turnId: this.resolveTurnId(msg, eventId),
        itemId: this.resolveItemId(msg, eventId, 'assistant'),
        delta: message,
      }
    }

    if (protoType === 'plan_delta') {
      return {
        type: 'plan_delta',
        threadId: this.resolveThreadId(msg),
        turnId: this.resolveTurnId(msg, eventId),
        itemId: this.resolveItemId(msg, eventId, 'plan'),
        delta: String(msg.delta ?? ''),
      }
    }

    if (
      protoType === 'reasoning_content_delta' ||
      protoType === 'reasoning_raw_content_delta'
    ) {
      const isSummary = protoType === 'reasoning_content_delta'
      return {
        type: 'reasoning_delta',
        threadId: this.resolveThreadId(msg),
        turnId: this.resolveTurnId(msg, eventId),
        itemId: this.resolveItemId(msg, eventId, 'reasoning'),
        delta: String(msg.delta ?? ''),
        summaryIndex: isSummary
          ? numberValue(msg.summary_index ?? msg.summaryIndex) ?? 0
          : undefined,
        contentIndex: isSummary
          ? undefined
          : numberValue(msg.content_index ?? msg.contentIndex) ?? 0,
      }
    }

    if (protoType === 'agent_reasoning_section_break') {
      return {
        type: 'reasoning_part_added',
        threadId: this.resolveThreadId(msg),
        turnId: this.resolveTurnId(msg, eventId),
        itemId: this.resolveItemId(msg, eventId, 'reasoning'),
        summaryIndex: numberValue(msg.summary_index ?? msg.summaryIndex),
        contentIndex: numberValue(msg.content_index ?? msg.contentIndex),
      }
    }

    if (protoType === 'exec_command_begin') {
      const itemId = this.resolveItemId(msg, eventId, 'command')
      return {
        type: 'item_started',
        threadId: this.resolveThreadId(msg),
        turnId: this.resolveTurnId(msg, eventId),
        itemId,
        item: {
          type: 'commandExecution',
          id: itemId,
          command: msg.command,
          cwd: msg.cwd,
          status: 'inProgress',
          raw: msg,
        },
      }
    }

    if (protoType === 'exec_command_output_delta') {
      return {
        type: 'command_output_delta',
        threadId: this.resolveThreadId(msg),
        turnId: this.resolveTurnId(msg, eventId),
        itemId: this.resolveItemId(msg, eventId, 'command'),
        delta: decodeBase64Utf8(String(msg.chunk ?? msg.delta ?? '')),
      }
    }

    if (protoType === 'exec_command_end') {
      const itemId = this.resolveItemId(msg, eventId, 'command')
      const exitCode = numberValue(msg.exit_code ?? msg.exitCode)
      return {
        type: 'item_completed',
        threadId: this.resolveThreadId(msg),
        turnId: this.resolveTurnId(msg, eventId),
        itemId,
        item: {
          type: 'commandExecution',
          id: itemId,
          command: msg.command,
          exitCode,
          status: exitCode === undefined || exitCode === 0 ? 'completed' : 'failed',
          raw: msg,
        },
      }
    }

    if (protoType === 'exec_approval_request') {
      return {
        type: 'approval_request',
        request: this.requestFromProto(
          'item/commandExecution/requestApproval',
          msg,
          eventId
        ),
      }
    }

    if (protoType === 'apply_patch_approval_request') {
      return {
        type: 'approval_request',
        request: this.requestFromProto('item/fileChange/requestApproval', msg, eventId),
      }
    }

    if (protoType === 'request_permissions') {
      return {
        type: 'server_request',
        request: this.requestFromProto(
          'item/permissions/requestApproval',
          msg,
          eventId
        ),
      }
    }

    if (protoType === 'request_user_input') {
      return {
        type: 'server_request',
        request: this.requestFromProto('item/tool/requestUserInput', msg, eventId),
      }
    }

    if (protoType === 'error') {
      return {
        type: 'error',
        error: new Error(String(msg.message ?? 'Codex proto turn failed')),
      }
    }

    if (protoType === 'warning') {
      return {
        type: 'warning',
        message: String(msg.message ?? 'Codex proto warning'),
        threadId: this.threadId,
      }
    }

    return {
      type: 'notification',
      method: `proto/${protoType}`,
      params: msg,
      threadId: this.threadId,
    }
  }

  private requestFromProto(
    method: string,
    msg: Record<string, unknown>,
    eventId?: string
  ): CodexWireServerRequest {
    return {
      id: this.resolveRequestId(msg, eventId),
      method,
      params: {
        ...msg,
        threadId: this.resolveThreadId(msg),
        turnId: this.resolveTurnId(msg, eventId),
      },
    }
  }

  private resolveThreadId(msg: Record<string, unknown>) {
    const threadId =
      stringValue(msg.thread_id) ??
      stringValue(msg.threadId) ??
      stringValue(msg.session_id) ??
      stringValue(msg.sessionId)
    if (threadId) this.threadId = threadId
    return this.threadId ?? this.appThreadId ?? 'codex-proto-thread'
  }

  private resolveTurnId(msg: Record<string, unknown>, eventId?: string) {
    const turnId =
      stringValue(msg.turn_id) ??
      stringValue(msg.turnId) ??
      stringValue(msg.submission_id) ??
      stringValue(msg.submissionId) ??
      this.activeTurnId ??
      eventId ??
      'codex-proto-turn'
    this.activeTurnId = turnId
    return turnId
  }

  private resolveItemId(
    msg: Record<string, unknown>,
    eventId: string | undefined,
    prefix: string
  ) {
    return (
      stringValue(msg.item_id) ??
      stringValue(msg.itemId) ??
      stringValue(msg.call_id) ??
      stringValue(msg.callId) ??
      eventId ??
      `${prefix}-${this.activeTurnId ?? 'current'}`
    )
  }

  private resolveRequestId(
    msg: Record<string, unknown>,
    eventId: string | undefined
  ): CodexRequestId {
    return (
      stringValue(msg.request_id) ??
      stringValue(msg.requestId) ??
      stringValue(msg.call_id) ??
      stringValue(msg.callId) ??
      eventId ??
      `proto-request-${Date.now()}`
    )
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const numberValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const decodeBase64Utf8 = (value: string) => {
  if (!value) return ''
  try {
    if (typeof atob === 'function') {
      const binaryString = atob(value)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      return new TextDecoder().decode(bytes)
    }
  } catch {
    return value
  }

  try {
    const bufferCtor = (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer
    if (bufferCtor) return bufferCtor.from(value, 'base64').toString('utf8')
  } catch {
    return value
  }

  return value
}
