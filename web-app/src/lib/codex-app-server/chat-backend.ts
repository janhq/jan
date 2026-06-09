import type { UIMessage } from '@ai-sdk/react'
import type { UIMessageChunk } from 'ai'
import { useThreads } from '@/hooks/useThreads'
import { useAppState } from '@/hooks/useAppState'
import { useToolApproval } from '@/hooks/useToolApproval'
import { useWorkspaceDirectories } from '@/stores/workspace-directory-store'
import { buildCodexConfigToml } from './config'
import { CodexAppServerClient } from './api'
import { TauriCodexProcessSpawner } from './tauri-process'
import { codexEventsToUIMessageStream } from './ui-stream'
import type { CodexAppServerEvent, CodexWireServerRequest } from './types'

export const CODEX_APP_SERVER_PROVIDER_ID = 'codex'

type CodexChatBackendRequest = {
  threadId: string
  messageId?: string
  messages: UIMessage[]
  provider: ModelProvider
  model: Model
  abortSignal?: AbortSignal
}

type CodexSessionEntry = {
  signature: string
  client: CodexAppServerClient
}

const sessions = new Map<string, CodexSessionEntry>()

export const isCodexAppServerProvider = (providerId: string | undefined) =>
  providerId === CODEX_APP_SERVER_PROVIDER_ID

export async function sendCodexAppServerChatMessage({
  threadId,
  messageId,
  messages,
  provider,
  model,
  abortSignal,
}: CodexChatBackendRequest): Promise<ReadableStream<UIMessageChunk>> {
  const messageText = extractLatestUserTextForCodex(messages)
  if (!messageText) {
    throw new Error('Cannot send an empty message to Codex app-server.')
  }

  const client = getOrCreateSession(threadId, provider, model)
  const events = bridgeCodexApprovalRequests(
    client.sendToCodex(threadId, messageText, {
      clientUserMessageId: messageId,
    }),
    client,
    threadId
  )

  let removeAbortListener: (() => void) | undefined
  if (abortSignal?.aborted) {
    await client.interruptTurn(threadId)
  } else if (abortSignal) {
    const interruptOnAbort = () => {
      void client.interruptTurn(threadId)
    }
    abortSignal.addEventListener('abort', interruptOnAbort, { once: true })
    removeAbortListener = () => {
      abortSignal.removeEventListener('abort', interruptOnAbort)
    }
  }

  return withCodexStreamCleanup(
    codexEventsToUIMessageStream(events, {
      messageId,
      interrupt: async () => {
        await client.interruptTurn(threadId)
      },
    }),
    threadId,
    removeAbortListener
  )
}

export function approveCodexAppServerAction(
  threadId: string,
  requestId: string | number,
  decision: { approved: boolean; rememberForSession?: boolean }
) {
  const entry = sessions.get(threadId)
  if (!entry) {
    throw new Error(`No Codex app-server session for thread: ${threadId}`)
  }
  entry.client.approveAction(
    requestId,
    codexApprovalResult(decision.approved, decision.rememberForSession)
  )
}

export async function shutdownCodexAppServerChatSession(threadId: string) {
  const entry = sessions.get(threadId)
  if (!entry) return
  sessions.delete(threadId)
  await entry.client.shutdownCodex()
}

async function* bridgeCodexApprovalRequests(
  events: AsyncIterable<CodexAppServerEvent>,
  client: CodexAppServerClient,
  threadId: string
): AsyncGenerator<CodexAppServerEvent> {
  for await (const event of events) {
    yield event
    if (event.type !== 'approval_request') continue

    const approved = await requestCodexApproval(event.request, threadId)
    client.approveAction(
      event.request.id,
      codexApprovalResult(approved, false)
    )
  }
}

async function requestCodexApproval(
  request: CodexWireServerRequest,
  threadId: string
) {
  const details = codexApprovalDetails(request)
  return useToolApproval
    .getState()
    .showApprovalModal(details.toolName, threadId, details.parameters)
}

function codexApprovalResult(approved: boolean, rememberForSession?: boolean) {
  return {
    decision: approved
      ? rememberForSession
        ? 'approved_for_session'
        : 'approved'
      : 'denied',
  }
}

function codexApprovalDetails(request: CodexWireServerRequest) {
  const params = isRecord(request.params) ? request.params : {}

  if (
    request.method === 'item/commandExecution/requestApproval' ||
    request.method === 'execCommandApproval'
  ) {
    return {
      toolName: 'Codex command',
      parameters: compactObject({
        command: commandValue(params.command),
        cwd: stringValue(params.cwd),
        reason: stringValue(params.reason),
      }),
    }
  }

  if (
    request.method === 'item/fileChange/requestApproval' ||
    request.method === 'applyPatchApproval'
  ) {
    return {
      toolName: 'Codex file change',
      parameters: compactObject({
        grantRoot: stringValue(params.grantRoot),
        reason: stringValue(params.reason),
      }),
    }
  }

  return {
    toolName: 'Codex action',
    parameters: {
      method: request.method,
      params,
    },
  }
}

export function clearCodexAppServerChatSessionsForTests() {
  sessions.clear()
}

function getOrCreateSession(
  threadId: string,
  provider: ModelProvider,
  model: Model
) {
  const options = buildCodexSessionOptions(threadId, provider, model)
  const signature = JSON.stringify({
    codexBinaryPath: options.codexBinaryPath,
    codexHome: options.codexHome,
    cwd: options.cwd,
    env: options.env,
    model: options.model,
    modelProvider: options.modelProvider,
    configToml: options.configToml,
  })
  const existing = sessions.get(threadId)
  if (existing?.signature === signature) return existing.client

  void existing?.client.shutdownCodex()
  const client = new CodexAppServerClient({
    spawner: new TauriCodexProcessSpawner(),
    options,
  })
  sessions.set(threadId, { signature, client })
  return client
}

export function buildCodexSessionOptions(
  threadId: string,
  provider: ModelProvider,
  model: Model
) {
  const targetProvider = settingValue(provider, 'codex-provider') || 'openai'
  const baseUrl =
    settingValue(provider, 'base-url') ||
    provider.base_url ||
    defaultBaseUrlForProvider(targetProvider)
  const apiKey = provider.api_key || settingValue(provider, 'api-key')
  const codexBinaryPath =
    settingValue(provider, 'codex-binary-path') || defaultCodexBinaryPath()
  const cwd = resolveCodexWorkspaceDir(threadId)
  const codexHome = codexHomeForWorkspace(cwd)
  const envKey = 'JAN_CODEX_PROVIDER_API_KEY'

  return {
    codexBinaryPath,
    codexHome,
    cwd,
    model: model.id,
    modelProvider: targetProvider,
    approvalPolicy: 'on-request' as const,
    sandbox: 'workspace-write' as const,
    configToml: buildCodexConfigToml({
      model: model.id,
      modelProvider: targetProvider,
      providers: [
        {
          id: targetProvider,
          name: targetProvider,
          baseUrl,
          apiKeyEnvVar: envKey,
          wireApi: 'responses',
        },
      ],
    }),
    env: apiKey ? { [envKey]: apiKey } : {},
  }
}

function resolveCodexWorkspaceDir(threadId: string) {
  const thread = useThreads.getState().threads[threadId]
  const projectId = thread?.metadata?.project?.id
  const directories = useWorkspaceDirectories.getState()
  if (projectId) {
    const projectDir = directories.getDirectory({
      type: 'project',
      id: projectId,
      label: thread?.metadata?.project?.name ?? 'Project',
    })
    if (projectDir) return projectDir
  }
  return (
    directories.getDirectory({
      type: 'chat',
      id: threadId,
      label: thread?.title ?? 'Chat',
    }) ?? './'
  )
}

function codexHomeForWorkspace(cwd: string) {
  const trimmed = cwd.trim().replace(/\/+$/, '')
  if (!trimmed || trimmed === '.') return './.jan/codex-home'
  if (trimmed === './') return './.jan/codex-home'
  return `${trimmed}/.jan/codex-home`
}

function settingValue(provider: ModelProvider, key: string) {
  const value = provider.settings.find((setting) => setting.key === key)
    ?.controller_props.value
  return typeof value === 'string' ? value.trim() : ''
}

function defaultCodexBinaryPath() {
  return IS_MACOS ? '/Applications/Codex.app/Contents/Resources/codex' : 'codex'
}

function defaultBaseUrlForProvider(providerId: string) {
  if (providerId === 'openai') return 'https://api.openai.com/v1'
  if (providerId === 'openrouter') return 'https://openrouter.ai/api/v1'
  if (providerId === 'ollama') return 'http://127.0.0.1:11434/v1'
  return 'https://api.openai.com/v1'
}

function extractLatestUserTextForCodex(messages: UIMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user') continue
    const text = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => (part as { text?: string }).text?.trim() ?? '')
      .filter(Boolean)
      .join('\n')
    if (text) return text
  }
  return ''
}

function compactObject(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  )
}

function commandValue(value: unknown) {
  if (Array.isArray(value)) {
    const command = value.filter((part) => typeof part === 'string').join(' ')
    return command.length > 0 ? command : undefined
  }
  return stringValue(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function withCodexStreamCleanup(
  stream: ReadableStream<UIMessageChunk>,
  threadId: string,
  onCleanup?: () => void
) {
  const reader = stream.getReader()
  const cleanup = () => {
    onCleanup?.()
    useAppState.getState().updatePromptProgress(undefined)
    useAppState.getState().updateLoadingModel(false)
    useAppState.getState().updateThreadPromptProgress(threadId, undefined)
    useAppState.getState().updateThreadLoadingModel(threadId, false)
    if (useAppState.getState().currentStreamThreadId === threadId) {
      useAppState.getState().setCurrentStreamThreadId(undefined)
    }
  }

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          cleanup()
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        cleanup()
        controller.error(error)
      }
    },
    async cancel(reason) {
      cleanup()
      await reader.cancel(reason)
    },
  })
}
