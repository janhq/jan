import { CodexAppServerSession } from './client'
import type { CodexProcessSpawner } from './process-manager'
import type {
  CodexAppServerEvent,
  CodexInitializeResult,
  CodexRequestId,
  CodexSessionOptions,
} from './types'

export type StartCodexSessionParams = {
  spawner: CodexProcessSpawner
  options: CodexSessionOptions
}

export type SendToCodexOptions = {
  cwd?: string
  clientUserMessageId?: string
}

export class CodexAppServerClient {
  private readonly session: CodexAppServerSession

  constructor(params: StartCodexSessionParams) {
    this.session = new CodexAppServerSession(params)
  }

  startCodexSession(): Promise<CodexInitializeResult> {
    return this.session.initialize()
  }

  sendToCodex(
    threadId: string,
    message: string,
    options: SendToCodexOptions = {}
  ): AsyncGenerator<CodexAppServerEvent> {
    return this.session.sendMessage({
      appThreadId: threadId,
      text: message,
      cwd: options.cwd,
      clientUserMessageId: options.clientUserMessageId,
    })
  }

  interruptTurn(threadId: string) {
    return this.session.interruptTurn(threadId)
  }

  approveAction(requestId: CodexRequestId, result: unknown) {
    this.session.respondToServerRequest(requestId, result)
  }

  shutdownCodex() {
    return this.session.shutdown()
  }

  restartCodex() {
    return this.session.restart()
  }
}

export async function startCodexSession(params: StartCodexSessionParams) {
  const client = new CodexAppServerClient(params)
  await client.startCodexSession()
  return client
}
