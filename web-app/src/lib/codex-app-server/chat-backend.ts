import type { UIMessage } from '@ai-sdk/react'
import type { UIMessageChunk } from 'ai'
import { invoke } from '@tauri-apps/api/core'
import { useThreads } from '@/hooks/useThreads'
import { useAppState } from '@/hooks/useAppState'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useWorkspaceDirectories } from '@/stores/workspace-directory-store'
import { useCodexProviderProfiles } from '@/stores/codex-provider-profile-store'
import { useCodexAppServerRuntime } from '@/stores/codex-app-server-runtime-store'
import { useRuntimePermission } from '@/stores/runtime-permission-store'
import { useModelProvider } from '@/hooks/useModelProvider'
import { buildCodexConfigToml } from './config'
import { buildCodexMcpServersConfig } from './mcp-config-bridge'
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
  const { text: messageText, images } =
    extractLatestUserTextAndImagesForCodex(messages)
  if (!messageText && images.length === 0) {
    throw new Error('Cannot send an empty message to Codex app-server.')
  }

  // Validate that the workspace directory exists before spawning
  const cwd = resolveCodexWorkspaceDir(threadId)
  if (cwd && cwd !== './') {
    const exists = await invoke<boolean>('exists_sync', { args: [cwd] }).catch(
      () => false
    )
    if (!exists) {
      throw new Error(
        `Workspace directory does not exist: "${cwd}". Please select a valid folder in the workspace bar below the chat input or link a valid project.`
      )
    }
  }

  const client = getOrCreateSession(threadId, provider, model)
  const events = bridgeCodexApprovalRequests(
    client.sendToCodex(threadId, messageText, {
      clientUserMessageId: messageId,
      images,
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
    codexApprovalResponse(
      { id: requestId, method: 'item/commandExecution/requestApproval' },
      decision.approved,
      decision.rememberForSession
    )
  )
}

export async function shutdownCodexAppServerChatSession(threadId: string) {
  const entry = sessions.get(threadId)
  if (!entry) return
  sessions.delete(threadId)
  await entry.client.shutdownCodex()
}

function requireCodexSession(janThreadId: string) {
  const entry = sessions.get(janThreadId)
  if (!entry) {
    throw new Error(
      `No Codex app-server session for thread: ${janThreadId}. Send a message first to start the session.`
    )
  }
  return entry.client
}

export async function compactCodexThread(janThreadId: string) {
  return requireCodexSession(janThreadId).compactThread(janThreadId)
}

export async function interruptCodexTurn(janThreadId: string) {
  return requireCodexSession(janThreadId).interruptTurn(janThreadId)
}

export async function rollbackCodexThread(janThreadId: string, numTurns = 1) {
  return requireCodexSession(janThreadId).rollbackThread(janThreadId, numTurns)
}

export async function reloadCodexUserConfig(janThreadId: string) {
  return requireCodexSession(janThreadId).reloadUserConfig()
}

export async function refreshCodexMcpServers(janThreadId: string) {
  return requireCodexSession(janThreadId).refreshMcpServers()
}

async function* bridgeCodexApprovalRequests(
  events: AsyncIterable<CodexAppServerEvent>,
  client: CodexAppServerClient,
  threadId: string
): AsyncGenerator<CodexAppServerEvent> {
  for await (const event of events) {
    yield event

    if (event.type === 'approval_request') {
      const approved = await requestCodexApproval(event.request, threadId)
      client.approveAction(
        event.request.id,
        codexApprovalResponse(event.request, approved, false)
      )
      continue
    }

    if (event.type === 'server_request') {
      const response = await resolveServerRequest(event.request)
      if (response !== undefined) {
        client.approveAction(event.request.id, response)
      }
    }
  }
}

async function requestCodexApproval(
  request: CodexWireServerRequest,
  threadId: string
) {
  const details = codexApprovalDetails(request)
  const params = isRecord(request.params) ? request.params : {}
  const codexThreadId =
    stringValue(params.threadId) || stringValue((request as { threadId?: unknown }).threadId)
  return useRuntimePermission.getState().requestPermission({
    actionId: details.actionId,
    actionLabel: details.toolName,
    category: details.category,
    resourceLabel: details.resourceLabel,
    risk: details.risk,
    rememberKey: details.rememberKey,
    details: {
      janThreadId: threadId,
      threadId,
      ...(codexThreadId ? { codexThreadId } : {}),
      ...(codexThreadId && codexThreadId !== threadId
        ? { source: 'subagent' as const }
        : {}),
      requestId: request.id,
      method: request.method,
      ...details.parameters,
    },
  })
}

function codexApprovalResponse(
  request: CodexWireServerRequest,
  approved: boolean,
  rememberForSession?: boolean
) {
  if (!shouldUseLegacyApprovalResponse(request)) {
    if (approved) {
      if (
        rememberForSession &&
        hasAvailableDecision(request, 'acceptForSession')
      ) {
        return { decision: 'acceptForSession' }
      }
      if (hasAvailableDecision(request, 'accept')) return { decision: 'accept' }
      return { decision: 'accept' }
    }

    if (hasAvailableDecision(request, 'decline')) return { decision: 'decline' }
    return { decision: 'cancel' }
  }

  if (request.method === 'mcpServer/elicitation/request') {
    return { action: approved ? 'accept' : 'decline' }
  }

  return {
    decision: approved
      ? rememberForSession
        ? 'approved_for_session'
        : 'approved'
      : 'denied',
  }
}

function hasAvailableDecision(
  request: CodexWireServerRequest,
  decision: string
) {
  if (!isRecord(request.params)) return false
  const available = request.params.availableDecisions
  if (!Array.isArray(available)) return false

  return available.some((candidate) => {
    if (typeof candidate === 'string') return candidate === decision
    if (isRecord(candidate) && decision in candidate) return true
    return false
  })
}

function shouldUseLegacyApprovalResponse(request: CodexWireServerRequest) {
  return (
    request.method === 'mcpServer/elicitation/request' ||
    !hasAvailableDecision(request, 'accept')
  )
}

async function resolveServerRequest(request: CodexWireServerRequest) {
  if (request.method === 'item/permissions/requestApproval') {
    const params = isRecord(request.params) ? request.params : {}
    return {
      permissions: isRecord(params.permissions)
        ? compactObject(params.permissions)
        : {},
    }
  }

  if (request.method === 'attestation/generate') {
    return { token: 'v1.jan-offline' }
  }

  if (request.method === 'item/tool/requestUserInput') {
    return resolveToolUserInputRequest(request)
  }

  if (request.method === 'item/tool/call') {
    // "Disconnect Jan": when the Codex engine (app-server) is the agent brain,
    // we no longer act as a tool proxy. Codex performs tool use against the
    // MCP servers we have declared for it in config.toml (mcp-config-bridge).
    // Any host-mediated item/tool/call is rejected with guidance.
    // (Approvals and user-input requests are still mediated here for UX.)
    return {
      success: false,
      contentItems: [
        {
          type: 'inputText',
          text:
            'Host tool proxy disabled. Codex executes tools directly via MCP servers ' +
            'declared in its per-session config.toml (sourced from Jan MCP settings).',
        },
      ],
    }
  }

  return {}
}

function resolveToolUserInputRequest(request: CodexWireServerRequest) {
  const params = isRecord(request.params) ? request.params : {}
  const questions = Array.isArray(params.questions) ? params.questions : []
  const answers: Record<string, string> = {}

  for (const question of questions) {
    if (!isRecord(question)) continue
    const id = stringValue(question.id)
    if (!id) continue

    const promptText =
      stringValue(question.question) ??
      stringValue(question.prompt) ??
      stringValue(question.header) ??
      id
    answers[id] = promptForCodexUserInput(promptText) ?? ''
  }

  return { answers }
}

function promptForCodexUserInput(message: string) {
  if (
    typeof globalThis === 'undefined' ||
    !('prompt' in globalThis) ||
    typeof globalThis.prompt !== 'function'
  ) {
    return undefined
  }

  return globalThis.prompt(message) ?? undefined
}

function codexApprovalDetails(request: CodexWireServerRequest) {
  const params = isRecord(request.params) ? request.params : {}

  if (
    request.method === 'item/commandExecution/requestApproval' ||
    request.method === 'execCommandApproval'
  ) {
    return {
      toolName: 'Codex command',
      actionId: 'codex.command-approval',
      category: 'shell' as const,
      risk: 'high' as const,
      resourceLabel: commandValue(params.command) ?? stringValue(params.cwd),
      rememberKey: commandValue(params.command)
        ? `codex:command:${commandValue(params.command)}`
        : undefined,
      parameters: compactObject({
        command: commandValue(params.command),
        cwd: stringValue(params.cwd),
        reason: stringValue(params.reason),
        codexThreadId: stringValue(params.threadId),
      }),
    }
  }

  if (
    request.method === 'item/fileChange/requestApproval' ||
    request.method === 'applyPatchApproval'
  ) {
    return {
      toolName: 'Codex file change',
      actionId: 'codex.file-change-approval',
      category: 'file' as const,
      risk: 'high' as const,
      resourceLabel: stringValue(params.grantRoot),
      rememberKey: stringValue(params.grantRoot)
        ? `codex:file-change:${stringValue(params.grantRoot)}`
        : undefined,
      parameters: compactObject({
        grantRoot: stringValue(params.grantRoot),
        reason: stringValue(params.reason),
        codexThreadId: stringValue(params.threadId),
      }),
    }
  }

  if (request.method === 'mcpServer/elicitation/request') {
    return {
      toolName: `MCP: ${stringValue(params.serverName) ?? 'server'}`,
      actionId: 'codex.mcp-elicitation',
      category: 'app' as const,
      risk: 'medium' as const,
      resourceLabel: stringValue(params.serverName),
      rememberKey: stringValue(params.serverName)
        ? `codex:mcp:${stringValue(params.serverName)}`
        : undefined,
      parameters: compactObject({
        message: stringValue(params.message),
        mode: stringValue(params.mode),
        url: stringValue(params.url),
        serverName: stringValue(params.serverName),
      }),
    }
  }

  return {
    toolName: 'Codex action',
    actionId: 'codex.action-approval',
    category: 'app' as const,
    risk: 'medium' as const,
    resourceLabel: request.method,
    rememberKey: `codex:action:${request.method}`,
    parameters: {
      method: request.method,
      params,
      // Include threadId so UI can highlight if this approval is from a subagent/child
      threadId:
        stringValue(params?.threadId) || stringValue((request as any).threadId),
    },
  }
}

export function clearCodexAppServerChatSessionsForTests() {
  sessions.clear()
}

/**
 * Send additional input ("steer") to a specific Codex sub-thread (child agent).
 * This is the high-level API for the UI to "open up" a subagent and talk to it directly.
 * Events from the steer will flow back through the normal stream (tagged with the sub threadId).
 */
export async function steerCodexSubThread(
  janThreadId: string,
  targetCodexThreadId: string,
  text: string,
  options?: {
    clientUserMessageId?: string
    images?: Array<{ data: string; mediaType: string }>
  }
) {
  const entry = sessions.get(janThreadId)
  if (!entry) {
    throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  }
  return entry.client.steerThread(
    targetCodexThreadId,
    text,
    options?.clientUserMessageId,
    options?.images
  )
}

/**
 * Steer a subagent and stream live Codex events (with approval bridging) until the
 * sub-thread turn completes. Powers the subagent inspector's live activity panel.
 */
export async function* steerCodexSubThreadEvents(
  janThreadId: string,
  targetCodexThreadId: string,
  text: string,
  options?: {
    clientUserMessageId?: string
    images?: Array<{ data: string; mediaType: string }>
  }
): AsyncGenerator<CodexAppServerEvent> {
  const entry = sessions.get(janThreadId)
  if (!entry) {
    throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  }
  const events = bridgeCodexApprovalRequests(
    entry.client.steerThreadWithEvents(
      targetCodexThreadId,
      text,
      options?.clientUserMessageId,
      options?.images
    ),
    entry.client,
    janThreadId
  )
  yield* events
}

/**
 * Start a Codex review against real git state. Delivery defaults to detached so
 * findings surface as analysis on top of the authoritative git-diff review panel.
 */
export async function startCodexReview(
  janThreadId: string,
  target:
    | { type: 'uncommittedChanges' }
    | { type: 'baseBranch'; branch: string }
    | { type: 'commit'; sha: string; title?: string }
    | { type: 'custom'; instructions: string } = { type: 'uncommittedChanges' },
  options?: { userFacingHint?: string }
) {
  const entry = sessions.get(janThreadId)
  if (!entry) {
    throw new Error(
      `No Codex app-server session for thread: ${janThreadId}. Send a message first to start the session.`
    )
  }
  return entry.client.startReview(janThreadId, target, {
    delivery: 'detached',
    userFacingHint:
      options?.userFacingHint ??
      'Review workspace changes. Provide structured analysis only — the host git-diff panel is the authoritative diff source.',
  })
}

/**
 * High-level access to Codex app-server runtime capabilities (the "next layer"
 * after static config/MCP/AGENTS emission).
 * These delegate to the active session for a Jan thread (Codex owns the
 * planning/execution; Jan owns the curation UI + approvals + workspace).
 * Skills, plugins, hooks, MCP OAuth, remote control, and live config are
 * all available via the app-server when the profile/chat is codex-backed.
 */
export async function listCodexSkills(janThreadId: string, params: Record<string, unknown> = {}) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.listSkills(params)
}

export async function setCodexSkillExtraRoots(janThreadId: string, roots: string[]) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.setSkillExtraRoots(roots)
}

export async function listCodexHooks(janThreadId: string, params: Record<string, unknown> = {}) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.listHooks(params)
}

export async function listCodexPlugins(janThreadId: string, params: Record<string, unknown> = {}) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.listPlugins(params)
}

export async function listInstalledCodexPlugins(janThreadId: string, params: Record<string, unknown> = {}) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.listInstalledPlugins(params)
}

export async function installCodexPlugin(janThreadId: string, params: Record<string, unknown>) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.installPlugin(params)
}

export async function uninstallCodexPlugin(janThreadId: string, params: Record<string, unknown>) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.uninstallPlugin(params)
}

export async function writeCodexSkillConfig(janThreadId: string, params: Record<string, unknown>) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.writeSkillConfig(params)
}

export async function startCodexMcpOauthLogin(janThreadId: string, server: string) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.startMcpOauthLogin(server)
}

export async function listCodexMcpServerStatus(janThreadId: string, params: Record<string, unknown> = {}) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.listMcpServerStatus(params)
}

export async function readCodexAccount(
  janThreadId: string,
  refreshToken = false
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.readAccount(refreshToken)
}

export async function startCodexAccountLogin(
  janThreadId: string,
  params: Record<string, unknown>
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.startAccountLogin(params)
}

export async function cancelCodexAccountLogin(
  janThreadId: string,
  loginId: string
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.cancelAccountLogin(loginId)
}

export async function logoutCodexAccount(janThreadId: string) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.logoutAccount()
}

export async function readCodexAccountRateLimits(janThreadId: string) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.readAccountRateLimits()
}

export async function readCodexAccountUsage(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.readAccountUsage(params)
}

export async function sendCodexAddCreditsNudgeEmail(
  janThreadId: string,
  creditType: 'credits' | 'usage_limit'
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.sendAddCreditsNudgeEmail(creditType)
}

export async function listCodexPermissionProfiles(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.listPermissionProfiles(params)
}

export async function listCodexCollaborationModes(janThreadId: string) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.listCollaborationModes()
}

export async function listCodexThreads(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.listThreads(params)
}

export async function listLoadedCodexThreads(janThreadId: string) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.listLoadedThreads()
}

export async function readCodexThread(
  janThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.readThread(codexThreadId, params)
}

export async function listCodexThreadTurns(
  janThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.listThreadTurns(codexThreadId, params)
}

export async function forkCodexThread(
  janThreadId: string,
  codexThreadId: string,
  params: Record<string, unknown> = {}
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.forkThread(codexThreadId, params)
}

export async function archiveCodexThread(
  janThreadId: string,
  codexThreadId: string
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.archiveThread(codexThreadId)
}

export async function unarchiveCodexThread(
  janThreadId: string,
  codexThreadId: string
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.unarchiveThread(codexThreadId)
}

export async function setCodexThreadName(
  janThreadId: string,
  codexThreadId: string,
  name: string
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.setThreadName(codexThreadId, name)
}

export async function setCodexThreadGoal(
  janThreadId: string,
  codexThreadId: string,
  goal: Record<string, unknown>
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.setThreadGoal(codexThreadId, goal)
}

export async function getCodexThreadGoal(
  janThreadId: string,
  codexThreadId: string
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.getThreadGoal(codexThreadId)
}

export async function clearCodexThreadGoal(
  janThreadId: string,
  codexThreadId: string
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.clearThreadGoal(codexThreadId)
}

export async function setCodexThreadMemoryMode(
  janThreadId: string,
  codexThreadId: string,
  memoryMode: 'enabled' | 'disabled'
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.setThreadMemoryMode(codexThreadId, memoryMode)
}

export async function enableCodexRemoteControl(janThreadId: string) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.enableRemoteControl()
}

export async function disableCodexRemoteControl(janThreadId: string) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.disableRemoteControl()
}

export async function readCodexRemoteControlStatus(janThreadId: string) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.readRemoteControlStatus()
}

export async function startCodexRemoteControlPairing(
  janThreadId: string,
  params: Record<string, unknown> = {}
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.startRemoteControlPairing(params)
}

export async function readCodexRemoteControlPairingStatus(
  janThreadId: string,
  params: { pairingCode?: string; manualPairingCode?: string }
) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.readRemoteControlPairingStatus(params)
}

export type CodexCliRunResult = {
  stdout: string
  stderr: string
  exitCode: number | null
}

/**
 * Run a Codex CLI subcommand (doctor, exec, resume, etc.) against a profile's CODEX_HOME.
 * Bridges non-interactive / diagnostic CLI features into Jan Studio.
 */
export async function runCodexCliSubcommand(input: {
  command: string
  args?: string[]
  cwd?: string
  codexHome?: string
  env?: Record<string, string>
}): Promise<CodexCliRunResult> {
  return invoke<CodexCliRunResult>('run_codex_cli_subcommand', {
    command: input.command,
    args: input.args ?? [],
    cwd: input.cwd ?? null,
    codexHome: input.codexHome ?? null,
    extraEnv: input.env ?? null,
  })
}

export async function runCodexDoctor(input?: {
  command?: string
  codexHome?: string
  cwd?: string
}) {
  return runCodexCliSubcommand({
    command: input?.command ?? 'codex',
    args: ['doctor'],
    codexHome: input?.codexHome,
    cwd: input?.cwd,
  })
}

/**
 * Run Codex non-interactively (`codex exec`). Bridges the CLI exec path for
 * automation, CI-style tasks, and Studio diagnostics outside app-server chat.
 */
export async function runCodexExec(input: {
  prompt: string
  command?: string
  codexHome?: string
  cwd?: string
  addDirs?: string[]
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  jsonOutput?: boolean
  outputLastMessage?: string
  extraArgs?: string[]
  env?: Record<string, string>
}) {
  const args = ['exec']
  if (input.sandbox) args.push('--sandbox', input.sandbox)
  if (input.jsonOutput) args.push('--json')
  if (input.outputLastMessage) {
    args.push('-o', input.outputLastMessage)
  }
  if (input.cwd) args.push('-C', input.cwd)
  for (const dir of input.addDirs ?? []) {
    if (dir.trim()) args.push('--add-dir', dir.trim())
  }
  if (input.extraArgs?.length) args.push(...input.extraArgs)
  args.push(input.prompt)
  return runCodexCliSubcommand({
    command: input.command ?? 'codex',
    args,
    codexHome: input.codexHome,
    cwd: input.cwd,
    env: input.env,
  })
}

/**
 * Resume a prior Codex CLI session (`codex resume`). Use sessionId or --last.
 */
export async function runCodexResume(input: {
  sessionId?: string
  prompt?: string
  last?: boolean
  command?: string
  codexHome?: string
  cwd?: string
  env?: Record<string, string>
}) {
  const args = ['resume']
  if (input.last) args.push('--last')
  if (input.sessionId?.trim()) args.push(input.sessionId.trim())
  if (input.prompt?.trim()) args.push(input.prompt.trim())
  return runCodexCliSubcommand({
    command: input.command ?? 'codex',
    args,
    codexHome: input.codexHome,
    cwd: input.cwd,
    env: input.env,
  })
}

export function getCodexAppServerRuntimeLogs(sessionId?: string, maxChars = 16000) {
  return useCodexAppServerRuntime.getState().getLogText(sessionId, maxChars)
}

// Generic escape hatch for other advanced app-server calls surfaced in the client
// (remoteControl/*, marketplace/*, collaborationMode, environment, apps, config read/write, etc.)
export async function callCodexAppServer(janThreadId: string, method: string, params?: Record<string, unknown>) {
  const entry = sessions.get(janThreadId)
  if (!entry) throw new Error(`No Codex app-server session for thread: ${janThreadId}`)
  return entry.client.requestAppServer(method, params)
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
    transport: options.transport,
    cwd: options.cwd,
    env: options.env,
    model: options.model,
    modelProvider: options.modelProvider,
    approvalPolicy: options.approvalPolicy,
    sandbox: options.sandbox,
    configToml: options.configToml,
    mcpRefreshConfig: options.mcpRefreshConfig,
    agentsMd: options.agentsMd,
    subagentMaxThreads: options.subagentMaxThreads,
    subagentMaxDepth: options.subagentMaxDepth,
    permissionProfile: options.permissionProfile,
    addDirs: options.addDirs,
    customAgents: options.customAgents,
    advancedConfigSnippet: options.advancedConfigSnippet,
    // images not in signature as per-turn
  })
  const existing = sessions.get(threadId)
  if (existing?.signature === signature) return existing.client

  void existing?.client.shutdownCodex()
  const client = new CodexAppServerClient({
    spawner: new TauriCodexProcessSpawner(),
    options,
  })
  sessions.set(threadId, { signature, client })
  // Sync runtime MCP config after spawn (config.toml is written at process start;
  // this ensures live Jan MCP curation changes are reflected in the running engine).
  void client.refreshMcpServers().catch(() => {})
  return client
}

export function buildCodexSessionOptions(
  threadId: string,
  provider: ModelProvider,
  model: Model
) {
  const activeProfileId = useCodexProviderProfiles.getState().activeProfileId
  const activeProfile = activeProfileId
    ? useCodexProviderProfiles.getState().profiles[activeProfileId]
    : undefined

  const targetProvider = activeProfile
    ? mapProfileProviderType(activeProfile.providerType)
    : settingValue(provider, 'codex-provider') || 'openai'

  const baseUrl = activeProfile
    ? activeProfile.baseUrl
    : settingValue(provider, 'base-url') ||
      provider.base_url ||
      defaultBaseUrlForProvider(targetProvider)

  let apiKey = ''
  if (activeProfile) {
    const mappedProviderName = mapProfileProviderType(
      activeProfile.providerType
    )
    const janProvider = useModelProvider
      .getState()
      .getProviderByName(mappedProviderName)
    apiKey =
      janProvider?.api_key ||
      (janProvider ? settingValue(janProvider, 'api-key') : '')
  } else {
    apiKey = provider.api_key || settingValue(provider, 'api-key')
  }

  const codexBinaryPath =
    settingValue(provider, 'codex-binary-path') || defaultCodexBinaryPath()
  const transport = normalizeCodexTransport(
    activeProfile?.transport || settingValue(provider, 'codex-transport')
  )
  const cwd = resolveCodexWorkspaceDir(threadId)
  const codexHome = activeProfile
    ? activeProfile.codexHome
    : codexHomeForWorkspace(cwd)
  const envKey = activeProfile?.apiKeyEnv || 'JAN_CODEX_PROVIDER_API_KEY'
  const { mcpServers, settings: mcpSettings } = useMCPServers.getState()
  const targetModel = (activeProfile && activeProfile.model.trim()) || model.id
  const approvalPolicy = activeProfile?.approvalPolicy || 'on-request'
  const sandbox = activeProfile?.sandbox || 'workspace-write'
  const agentsMd = activeProfile?.agentsMd
  const subagentMaxThreads = activeProfile?.subagentMaxThreads
  const subagentMaxDepth = activeProfile?.subagentMaxDepth
  const permissionProfile = activeProfile?.permissionProfile
  const addDirs = activeProfile?.addDirs
  const customAgents = activeProfile?.customAgents
  const advancedConfigSnippet = activeProfile?.advancedConfigSnippet

  return {
    codexBinaryPath,
    codexHome,
    transport,
    cwd,
    model: targetModel,
    modelProvider: targetProvider,
    approvalPolicy,
    sandbox,
    agentsMd,
    subagentMaxThreads,
    subagentMaxDepth,
    permissionProfile,
    addDirs,
    customAgents,
    advancedConfigSnippet,
    configToml: buildCodexConfigToml({
      model: targetModel,
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
      mcpServers,
      mcpToolTimeoutSeconds: mcpSettings.toolCallTimeoutSeconds,
      agents:
        subagentMaxThreads || subagentMaxDepth
          ? { max_threads: subagentMaxThreads, max_depth: subagentMaxDepth }
          : undefined,
      defaultPermissions: permissionProfile,
      advancedConfigSnippet: activeProfile?.advancedConfigSnippet,
    }),
    mcpRefreshConfig: {
      mcp_servers: buildCodexMcpServersConfig(mcpServers, {
        toolTimeoutSeconds: mcpSettings.toolCallTimeoutSeconds,
      }),
      mcp_oauth_credentials_store_mode: 'auto',
    },
    env: apiKey ? { [envKey]: apiKey } : {},
  }
}

function mapProfileProviderType(type: string): string {
  if (type === 'openai-compatible') return 'openai'
  if (type === 'llama-cpp') return 'llamacpp'
  return type
}

function normalizeCodexTransport(
  value?: string
): 'app-server' | 'proto' {
  return value === 'proto' ? 'proto' : 'app-server'
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

type CodexImageInput = {
  data: string // base64 without data: prefix, or full data url (will normalize)
  mediaType: string
}

function extractLatestUserTextAndImagesForCodex(messages: UIMessage[]): {
  text: string
  images: CodexImageInput[]
} {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user') continue

    const textParts = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => (part as { text?: string }).text?.trim() ?? '')
      .filter(Boolean)

    const text = textParts.join('\n')

    const images: CodexImageInput[] = []
    for (const part of message.parts) {
      if (part.type === 'file') {
        const p = part as { mediaType?: string; data?: string; url?: string }
        const mediaType = p.mediaType || ''
        if (mediaType.startsWith('image/')) {
          let data = p.data || p.url || ''
          // Normalize data url to raw base64 if needed
          if (data.startsWith('data:')) {
            const comma = data.indexOf(',')
            if (comma > -1) data = data.substring(comma + 1)
          }
          if (data) {
            images.push({ data, mediaType })
          }
        }
      }
    }

    if (text || images.length > 0) {
      return { text, images }
    }
  }
  return { text: '', images: [] }
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
