/* eslint-disable @typescript-eslint/no-unused-vars */
import { buildCodexSpawnCommand } from './config'
import { CodexProtoEventMapper } from './proto-adapter'
import type {
  CodexAccountLoginParams,
  CodexAddCreditsNudgeCreditType,
  CodexCommandExecParams,
  CodexFileSystemCopyParams,
  CodexFileSystemMetadata,
  CodexFileSystemRemoveParams,
  CodexMcpToolCallParams,
  CodexProcessSpawnParams,
  CodexRealtimeStartParams,
  CodexRemotePairingStatusParams,
  CodexReviewOptions,
  CodexReviewTarget,
} from './api'
import type { CodexProcessSpawner } from './process-manager'
import type {
  CodexAppServerEvent,
  CodexInitializeResult,
  CodexProcess,
  CodexRequestId,
  CodexSessionOptions,
  Unsubscribe,
} from './types'

type CodexProtoSessionParams = {
  spawner: CodexProcessSpawner
  options: CodexSessionOptions
}

type SendMessageParams = {
  appThreadId: string
  text: string
  cwd?: string
  clientUserMessageId?: string
  images?: Array<{ data: string; mediaType: string }>
}

export class CodexProtoSession {
  private process: CodexProcess | null = null
  private initializePromise: Promise<CodexInitializeResult> | null = null
  private readonly queue = createEventQueue()
  private readonly mapperByAppThreadId = new Map<string, CodexProtoEventMapper>()
  private readonly pendingRequestMethods = new Map<string, string>()
  private readonly unsubscriptions: Unsubscribe[] = []
  private sessionConfiguredEvent: CodexAppServerEvent | null = null
  private initialized = false

  constructor(private readonly params: CodexProtoSessionParams) {}

  initialize(): Promise<CodexInitializeResult> {
    if (this.initializePromise && this.process) return this.initializePromise

    const command = buildCodexSpawnCommand({
      ...this.params.options,
      transport: 'proto',
    })

    this.initializePromise = Promise.resolve(
      this.params.spawner.spawn(command.command, command.args, {
        cwd: command.cwd,
        env: command.env,
        codexHome: command.codexHome,
        configToml: command.configToml,
        agentsMd: command.agentsMd,
      })
    )
      .then(
        (process) =>
          new Promise<CodexInitializeResult>((resolve, reject) => {
            this.process = process
            const mapper = this.getMapper('codex-proto-bootstrap')
            const timeout = setTimeout(() => {
              reject(new Error('Codex proto initialization timed out'))
            }, 60_000)

            const cleanupInit = () => clearTimeout(timeout)
            this.unsubscriptions.push(
              process.onStdoutLine((line) => {
                const event = mapProtoLine(mapper, line)
                if (!event) return
                if (event.type === 'thread_started' && !this.initialized) {
                  this.initialized = true
                  this.sessionConfiguredEvent = event
                  cleanupInit()
                  resolve({
                    userAgent: 'codex-proto',
                    codexHome: command.codexHome,
                  })
                  return
                }
                this.rememberRequest(event)
                this.queue.push(event)
              }),
              process.onStderrLine((line) => {
                if (!line.trim()) return
                if (isRejectedProtoSubmission(line)) {
                  this.queue.push({
                    type: 'error',
                    error: new Error(
                      `Codex proto rejected a submission: ${line}`
                    ),
                  })
                  return
                }
                this.queue.push({ type: 'warning', message: line })
              }),
              process.onExit((exit) => {
                this.queue.push({
                  type: 'error',
                  error: new Error(
                    `Codex proto exited with code ${exit.code ?? 'null'}${
                      exit.signal ? ` and signal ${exit.signal}` : ''
                    }`
                  ),
                })
              })
            )
          })
      )
      .catch((error) => {
        this.initializePromise = null
        throw error
      })

    return this.initializePromise
  }

  async *sendMessage(
    params: SendMessageParams
  ): AsyncGenerator<CodexAppServerEvent> {
    await this.initialize()
    if (!this.process) throw new Error('Codex proto process is not running')

    const mapper = this.getMapper(params.appThreadId)
    if (this.sessionConfiguredEvent?.type === 'thread_started') {
      yield {
        ...this.sessionConfiguredEvent,
        appThreadId: params.appThreadId,
      }
    }

    const turnId = params.clientUserMessageId ?? createId('turn')
    await this.process.writeLine(
      JSON.stringify({
        id: turnId,
        op: {
          type: 'user_input',
          items: buildUserInputItems(params),
          cwd: params.cwd ?? this.params.options.cwd ?? null,
          approval_policy: this.params.options.approvalPolicy ?? null,
          sandbox: this.params.options.sandbox ?? null,
          model: this.params.options.model ?? null,
        },
        client_user_message_id: params.clientUserMessageId ?? null,
      })
    )

    let completed = false
    while (!completed) {
      const event = await this.queue.next()
      const mappedEvent = remapWithThread(mapper, event)
      this.rememberRequest(mappedEvent)
      yield mappedEvent
      completed =
        mappedEvent.type === 'turn_completed' || mappedEvent.type === 'error'
    }
  }

  interruptTurn() {
    return this.writeSubmission({
      id: createId('interrupt'),
      op: { type: 'interrupt' },
    })
  }

  compactThread() {
    return this.writeSubmission({
      id: createId('compact'),
      op: { type: 'compact' },
    })
  }

  reloadUserConfig() {
    return this.writeSubmission({
      id: createId('reload-user-config'),
      op: { type: 'reload_user_config' },
    })
  }

  refreshMcpServers() {
    return this.writeSubmission({
      id: createId('refresh-mcp-servers'),
      op: {
        type: 'refresh_mcp_servers',
        config: this.params.options.mcpRefreshConfig ?? {
          mcp_servers: {},
          mcp_oauth_credentials_store_mode: 'auto',
        },
      },
    })
  }

  runShellCommand(_appThreadId: string, command: string) {
    return this.writeSubmission({
      id: createId('shell-command'),
      op: {
        type: 'run_user_shell_command',
        command,
      },
    })
  }

  rollbackThread(_appThreadId: string, numTurns = 1) {
    return this.writeSubmission({
      id: createId('thread-rollback'),
      op: {
        type: 'thread_rollback',
        num_turns: normalizePositiveTurnCount(numTurns),
      },
    })
  }

  startReview(
    _appThreadId: string,
    target: CodexReviewTarget,
    options: CodexReviewOptions = {}
  ) {
    return this.writeSubmission({
      id: createId('review'),
      op: {
        type: 'review',
        review_request: {
          target,
          ...(options.userFacingHint
            ? { user_facing_hint: options.userFacingHint }
            : {}),
        },
      },
    })
  }

  execCommand(_params: CodexCommandExecParams) {
    return Promise.reject(
      new Error('command/exec is only available with Codex app-server transport')
    )
  }

  writeCommandStdin(
    _processId: string,
    _input: { deltaBase64?: string; closeStdin?: boolean }
  ) {
    return Promise.reject(
      new Error('command/exec/write is only available with Codex app-server transport')
    )
  }

  resizeCommandPty(_processId: string, _size: { rows: number; cols: number }) {
    return Promise.reject(
      new Error('command/exec/resize is only available with Codex app-server transport')
    )
  }

  terminateCommand(_processId: string) {
    return Promise.reject(
      new Error('command/exec/terminate is only available with Codex app-server transport')
    )
  }

  spawnProcess(_params: CodexProcessSpawnParams) {
    return unsupportedAppServerMethod('process/spawn')
  }

  writeProcessStdin(
    _processHandle: string,
    _input: { deltaBase64?: string; closeStdin?: boolean }
  ) {
    return unsupportedAppServerMethod('process/writeStdin')
  }

  resizeProcessPty(
    _processHandle: string,
    _size: { rows: number; cols: number }
  ) {
    return unsupportedAppServerMethod('process/resizePty')
  }

  killProcess(_processHandle: string) {
    return unsupportedAppServerMethod('process/kill')
  }

  readFile(_path: string): Promise<{ dataBase64: string }> {
    return Promise.reject(
      new Error('fs/readFile is only available with Codex app-server transport')
    )
  }

  writeFile(
    _path: string,
    _dataBase64: string
  ): Promise<Record<string, never>> {
    return Promise.reject(
      new Error('fs/writeFile is only available with Codex app-server transport')
    )
  }

  createDirectory(
    _path: string,
    _recursive?: boolean
  ): Promise<Record<string, never>> {
    return Promise.reject(
      new Error('fs/createDirectory is only available with Codex app-server transport')
    )
  }

  getMetadata(_path: string): Promise<CodexFileSystemMetadata> {
    return Promise.reject(
      new Error('fs/getMetadata is only available with Codex app-server transport')
    )
  }

  readDirectory(_path: string): Promise<{
    entries: Array<{ fileName: string; isDirectory: boolean; isFile: boolean }>
  }> {
    return Promise.reject(
      new Error('fs/readDirectory is only available with Codex app-server transport')
    )
  }

  removeFileSystemPath(
    _params: CodexFileSystemRemoveParams
  ): Promise<Record<string, never>> {
    return Promise.reject(
      new Error('fs/remove is only available with Codex app-server transport')
    )
  }

  copyFileSystemPath(
    _params: CodexFileSystemCopyParams
  ): Promise<Record<string, never>> {
    return Promise.reject(
      new Error('fs/copy is only available with Codex app-server transport')
    )
  }

  watchFileSystem(_watchId: string, _path: string): Promise<{ path: string }> {
    return Promise.reject(
      new Error('fs/watch is only available with Codex app-server transport')
    )
  }

  unwatchFileSystem(_watchId: string): Promise<Record<string, never>> {
    return Promise.reject(
      new Error('fs/unwatch is only available with Codex app-server transport')
    )
  }

  listModels(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('model/list')
  }

  readModelProviderCapabilities(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('modelProvider/capabilities/read')
  }

  listExperimentalFeatures(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('experimentalFeature/list')
  }

  listPermissionProfiles(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('permissionProfile/list')
  }

  setExperimentalFeatureEnablement(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('experimentalFeature/enablement/set')
  }

  addEnvironment(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('environment/add')
  }

  listCollaborationModes() {
    return unsupportedAppServerMethod('collaborationMode/list')
  }

  listSkills(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('skills/list')
  }

  setSkillExtraRoots(_roots: string[]) {
    return unsupportedAppServerMethod('skills/extraRoots/set')
  }

  listHooks(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('hooks/list')
  }

  addMarketplace(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('marketplace/add')
  }

  removeMarketplace(_marketplaceName: string) {
    return unsupportedAppServerMethod('marketplace/remove')
  }

  upgradeMarketplace(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('marketplace/upgrade')
  }

  listPlugins(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('plugin/list')
  }

  listInstalledPlugins(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('plugin/installed')
  }

  readPlugin(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('plugin/read')
  }

  readPluginSkill(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('plugin/skill/read')
  }

  listApps(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('app/list')
  }

  readAccount(_refreshToken = false) {
    return unsupportedAppServerMethod('account/read')
  }

  startAccountLogin(_params: CodexAccountLoginParams) {
    return unsupportedAppServerMethod('account/login/start')
  }

  cancelAccountLogin(_loginId: string) {
    return unsupportedAppServerMethod('account/login/cancel')
  }

  logoutAccount() {
    return unsupportedAppServerMethod('account/logout')
  }

  readAccountRateLimits() {
    return unsupportedAppServerMethod('account/rateLimits/read')
  }

  readAccountUsage(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('account/usage/read')
  }

  sendAddCreditsNudgeEmail(_creditType: CodexAddCreditsNudgeCreditType) {
    return unsupportedAppServerMethod('account/sendAddCreditsNudgeEmail')
  }

  enableRemoteControl() {
    return unsupportedAppServerMethod('remoteControl/enable')
  }

  disableRemoteControl() {
    return unsupportedAppServerMethod('remoteControl/disable')
  }

  readRemoteControlStatus() {
    return unsupportedAppServerMethod('remoteControl/status/read')
  }

  startRemoteControlPairing(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('remoteControl/pairing/start')
  }

  readRemoteControlPairingStatus(_params: CodexRemotePairingStatusParams) {
    return unsupportedAppServerMethod('remoteControl/pairing/status')
  }

  listRemoteControlClients(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('remoteControl/client/list')
  }

  revokeRemoteControlClient(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('remoteControl/client/revoke')
  }

  writeSkillConfig(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('skills/config/write')
  }

  installPlugin(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('plugin/install')
  }

  uninstallPlugin(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('plugin/uninstall')
  }

  startMcpOauthLogin(_server: string) {
    return unsupportedAppServerMethod('mcpServer/oauth/login')
  }

  requestUserInput(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('tool/requestUserInput')
  }

  listMcpServerStatus(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('mcpServerStatus/list')
  }

  readMcpResource(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('mcpServer/resource/read')
  }

  callMcpTool(_params: CodexMcpToolCallParams) {
    return unsupportedAppServerMethod('mcpServer/tool/call')
  }

  startWindowsSandboxSetup(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('windowsSandbox/setupStart')
  }

  uploadFeedback(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('feedback/upload')
  }

  readConfig() {
    return unsupportedAppServerMethod('config/read')
  }

  detectExternalAgentConfig(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('externalAgentConfig/detect')
  }

  importExternalAgentConfig(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('externalAgentConfig/import')
  }

  writeConfigValue(_keyPath: string, _value: unknown) {
    return unsupportedAppServerMethod('config/value/write')
  }

  batchWriteConfig(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('config/batchWrite')
  }

  readConfigRequirements() {
    return unsupportedAppServerMethod('configRequirements/read')
  }

  requestAppServer(method: string, _params?: Record<string, unknown>) {
    return unsupportedAppServerMethod(method)
  }

  listThreads(_params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('thread/list')
  }

  listLoadedThreads() {
    return unsupportedAppServerMethod('thread/loaded/list')
  }

  readThread(_threadId: string, _params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('thread/read')
  }

  listThreadTurns(_threadId: string, _params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('thread/turns/list')
  }

  listThreadTurnItems(_params: Record<string, unknown>) {
    return unsupportedAppServerMethod('thread/turns/items/list')
  }

  forkThread(_threadId: string, _params: Record<string, unknown> = {}) {
    return unsupportedAppServerMethod('thread/fork')
  }

  updateThreadMetadata(_threadId: string, _params: Record<string, unknown>) {
    return unsupportedAppServerMethod('thread/metadata/update')
  }

  updateThreadSettings(_threadId: string, _settings: Record<string, unknown>) {
    return unsupportedAppServerMethod('thread/settings/update')
  }

  setThreadMemoryMode(
    _threadId: string,
    _memoryMode: 'enabled' | 'disabled'
  ) {
    return unsupportedAppServerMethod('thread/memoryMode/set')
  }

  resetMemory() {
    return unsupportedAppServerMethod('memory/reset')
  }

  setThreadGoal(_threadId: string, _goal: Record<string, unknown>) {
    return unsupportedAppServerMethod('thread/goal/set')
  }

  getThreadGoal(_threadId: string) {
    return unsupportedAppServerMethod('thread/goal/get')
  }

  clearThreadGoal(_threadId: string) {
    return unsupportedAppServerMethod('thread/goal/clear')
  }

  archiveThread(_threadId: string) {
    return unsupportedAppServerMethod('thread/archive')
  }

  unsubscribeThread(_threadId: string) {
    return unsupportedAppServerMethod('thread/unsubscribe')
  }

  setThreadName(_threadId: string, _name: string) {
    return unsupportedAppServerMethod('thread/name/set')
  }

  unarchiveThread(_threadId: string) {
    return unsupportedAppServerMethod('thread/unarchive')
  }

  injectThreadItems(_threadId: string, _items: unknown[]) {
    return unsupportedAppServerMethod('thread/inject_items')
  }

  cleanBackgroundTerminals(_threadId: string) {
    return unsupportedAppServerMethod('thread/backgroundTerminals/clean')
  }

  startThreadRealtime(
    _threadId: string,
    _params: CodexRealtimeStartParams = {}
  ) {
    return unsupportedAppServerMethod('thread/realtime/start')
  }

  appendThreadRealtimeAudio(_threadId: string, _audioBase64: string) {
    return unsupportedAppServerMethod('thread/realtime/appendAudio')
  }

  appendThreadRealtimeText(_threadId: string, _text: string) {
    return unsupportedAppServerMethod('thread/realtime/appendText')
  }

  stopThreadRealtime(_threadId: string) {
    return unsupportedAppServerMethod('thread/realtime/stop')
  }

  steerThread(
    _targetThreadId: string,
    text: string,
    clientUserMessageId?: string
  ) {
    return this.writeSubmission({
      id: clientUserMessageId ?? createId('steer'),
      op: {
        type: 'user_input',
        items: [{ type: 'text', text, text_elements: [] }],
      },
      client_user_message_id: clientUserMessageId ?? null,
    })
  }

  respondToServerRequest(requestId: CodexRequestId, result: unknown) {
    const requestKey = String(requestId)
    const requestMethod = this.pendingRequestMethods.get(requestKey)
    this.pendingRequestMethods.delete(requestKey)

    if (requestMethod === 'item/tool/requestUserInput') {
      return this.writeSubmission({
        id: createId('user-input-answer'),
        op: {
          type: 'user_input_answer',
          id: requestKey,
          response: normalizeUserInputAnswer(result),
        },
      })
    }

    if (requestMethod === 'item/permissions/requestApproval') {
      return this.writeSubmission({
        id: createId('request-permissions-response'),
        op: {
          type: 'request_permissions_response',
          id: requestKey,
          response: normalizePermissionsResponse(result),
        },
      })
    }

    const decision = normalizeDecision(result)
    const opType =
      requestMethod === 'item/fileChange/requestApproval'
        ? 'patch_approval'
        : 'exec_approval'
    return this.writeSubmission({
      id: createId('approval-response'),
      op: {
        type: opType,
        id: requestKey,
        decision,
      },
    })
  }

  async shutdown() {
    await this.writeSubmission({
      id: createId('shutdown'),
      op: { type: 'shutdown' },
    })
    this.unsubscriptions.splice(0).forEach((unsubscribe) => unsubscribe())
    await this.process?.kill()
    this.process = null
    this.initializePromise = null
    this.initialized = false
  }

  restart() {
    return this.shutdown().then(() => this.initialize())
  }

  private getMapper(appThreadId: string) {
    const existing = this.mapperByAppThreadId.get(appThreadId)
    if (existing) return existing
    const mapper = new CodexProtoEventMapper({ appThreadId })
    if (this.sessionConfiguredEvent?.type === 'thread_started') {
      mapper.map({
        id: '0',
        msg: {
          type: 'session_configured',
          session_id: this.sessionConfiguredEvent.threadId,
        },
      })
    }
    this.mapperByAppThreadId.set(appThreadId, mapper)
    return mapper
  }

  private writeSubmission(submission: unknown) {
    if (!this.process) return Promise.resolve(null)
    return Promise.resolve(this.process.writeLine(JSON.stringify(submission)))
  }

  private rememberRequest(event: CodexAppServerEvent) {
    if (event.type !== 'approval_request' && event.type !== 'server_request') {
      return
    }
    this.pendingRequestMethods.set(
      String(event.request.id),
      event.request.method
    )
  }
}

const mapProtoLine = (mapper: CodexProtoEventMapper, line: string) => {
  if (!line.trim()) return null
  try {
    return mapper.map(JSON.parse(line))
  } catch (error) {
    return {
      type: 'error',
      error: new Error(
        `Malformed Codex proto message: ${String((error as Error).message)}`
      ),
    } satisfies CodexAppServerEvent
  }
}

const remapWithThread = (
  mapper: CodexProtoEventMapper,
  event: CodexAppServerEvent
) => {
  if (event.type !== 'notification' || !event.method.startsWith('proto/')) {
    return event
  }
  const remapped = mapper.map({ id: undefined, msg: event.params })
  return remapped ?? event
}

const buildUserInputItems = (params: SendMessageParams) => {
  const items: unknown[] = []
  if (params.text) {
    items.push({ type: 'text', text: params.text, text_elements: [] })
  }
  if (params.images) {
    params.images.forEach((image) => {
      items.push({
        type: 'image',
        image: { data: image.data, media_type: image.mediaType },
      })
    })
  }
  return items.length > 0
    ? items
    : [{ type: 'text', text: '', text_elements: [] }]
}

const normalizeDecision = (result: unknown) => {
  if (isRecord(result)) {
    const decision = result.decision ?? result.action
    if (decision === 'approved' || decision === 'accept') return 'approved'
    if (decision === 'approved_for_session' || decision === 'acceptForSession') {
      return 'approved_for_session'
    }
  }
  return 'denied'
}

const normalizeUserInputAnswer = (result: unknown) => {
  if (isRecord(result) && isRecord(result.answers)) {
    return { answers: result.answers }
  }
  return { answers: {} }
}

const normalizePermissionsResponse = (result: unknown) => {
  const permissions =
    isRecord(result) && isRecord(result.permissions) ? result.permissions : {}
  const scope =
    isRecord(result) && result.scope === 'session' ? 'session' : 'turn'
  return {
    permissions,
    scope,
    strict_auto_review:
      isRecord(result) && result.strict_auto_review === true,
  }
}

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
      return new Promise<CodexAppServerEvent>((resolve) =>
        waiters.push(resolve)
      )
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isRejectedProtoSubmission = (line: string) =>
  line.includes('invalid submission: unknown variant') ||
  line.includes('invalid submission: missing field') ||
  line.includes('invalid submission:')

const normalizePositiveTurnCount = (value: number) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 1

const unsupportedAppServerMethod = (method: string) =>
  Promise.reject(
    new Error(`${method} is only available with Codex app-server transport`)
  )

const createId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
