import { buildThreadStartParams } from './config'
import {
  CodexAppServerProcessManager,
  type CodexProcessSpawner,
} from './process-manager'
import type {
  CodexAccountLoginParams,
  CodexAddCreditsNudgeCreditType,
  CodexCommandExecParams,
  CodexFileSystemCopyParams,
  CodexFileSystemDirectoryEntry,
  CodexFileSystemMetadata,
  CodexFileSystemRemoveParams,
  CodexMcpToolCallParams,
  CodexProcessSpawnParams,
  CodexRealtimeStartParams,
  CodexRemotePairingStatusParams,
  CodexReviewOptions,
  CodexReviewTarget,
} from './api'
import type {
  CodexAppServerEvent,
  CodexInitializeResult,
  CodexSessionOptions,
  CodexRequestId,
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
  images?: Array<{ data: string; mediaType: string }>
}

type CodexInputItem =
  | { type: 'text'; text: string; text_elements: unknown[] }
  | { type: 'image'; image: { data: string; media_type: string } }

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
    this.manager = new CodexAppServerProcessManager(
      params.spawner,
      params.options
    )
  }

  initialize(): Promise<CodexInitializeResult> {
    return this.manager.initialize()
  }

  async *sendMessage(
    params: SendMessageParams
  ): AsyncGenerator<CodexAppServerEvent> {
    await this.initialize()

    const mapping = await this.ensureThread(params.appThreadId)
    if (!mapping.codexThreadId) {
      throw new Error(
        `Codex thread was not created for Jan thread ${params.appThreadId}`
      )
    }

    const queue = createEventQueue()
    const unsubscriptions: Unsubscribe[] = [
      this.manager.rpc.onNotification((message) => {
        const event = mapNotificationToEvent(message)
        if (!event) return
        // Allow events from child subagent threads (Codex spawns parallel agents for complex tasks).
        // The main response consolidates, but we surface subagent progress/activity in the UI.
        // Previously filtered to only main codexThreadId.
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
      thread: this.threadPayloads.get(params.appThreadId) ?? {
        id: mapping.codexThreadId,
      },
    }

    try {
      const input: CodexInputItem[] = []
      if (params.text) {
        input.push({ type: 'text', text: params.text, text_elements: [] })
      }
      if (params.images && params.images.length > 0) {
        for (const img of params.images) {
          input.push({
            type: 'image',
            image: { data: img.data, media_type: img.mediaType },
          })
        }
      }

      const response = await this.manager.rpc.request<TurnStartResponse>(
        'turn/start',
        {
          threadId: mapping.codexThreadId,
          clientUserMessageId: params.clientUserMessageId ?? null,
          input:
            input.length > 0
              ? input
              : [{ type: 'text', text: '', text_elements: [] }],
          cwd: params.cwd ?? this.params.options.cwd ?? null,
          approvalPolicy: this.params.options.approvalPolicy ?? null,
          model: this.params.options.model ?? null,
        }
      )

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

  async compactThread(appThreadId: string) {
    await this.initialize()
    const mapping = await this.ensureThread(appThreadId)
    if (!mapping.codexThreadId) {
      throw new Error(
        `Codex thread was not created for Jan thread ${appThreadId}`
      )
    }

    return this.manager.rpc.request('thread/compact/start', {
      threadId: mapping.codexThreadId,
    })
  }

  async reloadUserConfig() {
    await this.initialize()
    return this.manager.rpc.request('config/batchWrite', {
      edits: [],
      reloadUserConfig: true,
    })
  }

  async refreshMcpServers() {
    await this.initialize()
    const mcpServers = this.params.options.mcpRefreshConfig?.mcp_servers
    if (mcpServers) {
      await this.manager.rpc.request('config/value/write', {
        keyPath: 'mcp_servers',
        value: mcpServers,
      })
    }
    return this.manager.rpc.request('config/mcpServer/reload')
  }

  async runShellCommand(appThreadId: string, command: string) {
    await this.initialize()
    const mapping = await this.ensureThread(appThreadId)
    if (!mapping.codexThreadId) {
      throw new Error(
        `Codex thread was not created for Jan thread ${appThreadId}`
      )
    }

    return this.manager.rpc.request('thread/shellCommand', {
      threadId: mapping.codexThreadId,
      command,
    })
  }

  async rollbackThread(appThreadId: string, numTurns = 1) {
    await this.initialize()
    const mapping = await this.ensureThread(appThreadId)
    if (!mapping.codexThreadId) {
      throw new Error(
        `Codex thread was not created for Jan thread ${appThreadId}`
      )
    }

    return this.manager.rpc.request('thread/rollback', {
      threadId: mapping.codexThreadId,
      numTurns: normalizePositiveTurnCount(numTurns),
    })
  }

  async startReview(
    appThreadId: string,
    target: CodexReviewTarget,
    options: CodexReviewOptions = {}
  ) {
    await this.initialize()
    const mapping = await this.ensureThread(appThreadId)
    if (!mapping.codexThreadId) {
      throw new Error(
        `Codex thread was not created for Jan thread ${appThreadId}`
      )
    }

    // Default to 'detached' so review findings/analysis are surfaced via the real git-diff
    // review panel (the authoritative view in the agent workspace). The agent must not
    // be the source of the diff content itself.
    const delivery = options.delivery ?? 'detached'

    return this.manager.rpc.request('review/start', {
      threadId: mapping.codexThreadId,
      delivery,
      target,
      ...(options.userFacingHint
        ? { userFacingHint: options.userFacingHint }
        : {}),
    })
  }

  async execCommand(params: CodexCommandExecParams) {
    await this.initialize()
    return this.manager.rpc.request('command/exec', params)
  }

  async writeCommandStdin(
    processId: string,
    input: { deltaBase64?: string; closeStdin?: boolean }
  ) {
    await this.initialize()
    return this.manager.rpc.request('command/exec/write', {
      processId,
      ...input,
    })
  }

  async resizeCommandPty(
    processId: string,
    size: { rows: number; cols: number }
  ) {
    await this.initialize()
    return this.manager.rpc.request('command/exec/resize', {
      processId,
      size,
    })
  }

  async terminateCommand(processId: string) {
    await this.initialize()
    return this.manager.rpc.request('command/exec/terminate', { processId })
  }

  async spawnProcess(params: CodexProcessSpawnParams) {
    await this.initialize()
    return this.manager.rpc.request('process/spawn', params)
  }

  async writeProcessStdin(
    processHandle: string,
    input: { deltaBase64?: string; closeStdin?: boolean }
  ) {
    await this.initialize()
    return this.manager.rpc.request('process/writeStdin', {
      processHandle,
      ...input,
    })
  }

  async resizeProcessPty(
    processHandle: string,
    size: { rows: number; cols: number }
  ) {
    await this.initialize()
    return this.manager.rpc.request('process/resizePty', {
      processHandle,
      size,
    })
  }

  async killProcess(processHandle: string) {
    await this.initialize()
    return this.manager.rpc.request('process/kill', { processHandle })
  }

  async readFile(path: string): Promise<{ dataBase64: string }> {
    await this.initialize()
    return this.manager.rpc.request('fs/readFile', { path })
  }

  async writeFile(
    path: string,
    dataBase64: string
  ): Promise<Record<string, never>> {
    await this.initialize()
    return this.manager.rpc.request('fs/writeFile', { path, dataBase64 })
  }

  async createDirectory(
    path: string,
    recursive?: boolean
  ): Promise<Record<string, never>> {
    await this.initialize()
    return this.manager.rpc.request('fs/createDirectory', {
      path,
      ...(recursive === undefined ? {} : { recursive }),
    })
  }

  async getMetadata(path: string): Promise<CodexFileSystemMetadata> {
    await this.initialize()
    return this.manager.rpc.request('fs/getMetadata', { path })
  }

  async readDirectory(path: string): Promise<{
    entries: CodexFileSystemDirectoryEntry[]
  }> {
    await this.initialize()
    return this.manager.rpc.request('fs/readDirectory', { path })
  }

  async removeFileSystemPath(
    params: CodexFileSystemRemoveParams
  ): Promise<Record<string, never>> {
    await this.initialize()
    return this.manager.rpc.request('fs/remove', params)
  }

  async copyFileSystemPath(
    params: CodexFileSystemCopyParams
  ): Promise<Record<string, never>> {
    await this.initialize()
    return this.manager.rpc.request('fs/copy', params)
  }

  async watchFileSystem(
    watchId: string,
    path: string
  ): Promise<{ path: string }> {
    await this.initialize()
    return this.manager.rpc.request('fs/watch', { watchId, path })
  }

  async unwatchFileSystem(watchId: string): Promise<Record<string, never>> {
    await this.initialize()
    return this.manager.rpc.request('fs/unwatch', { watchId })
  }

  async listModels(params: Record<string, unknown> = {}) {
    return this.requestAppServer('model/list', params)
  }

  async readModelProviderCapabilities(params: Record<string, unknown> = {}) {
    return this.requestAppServer('modelProvider/capabilities/read', params)
  }

  async listExperimentalFeatures(params: Record<string, unknown> = {}) {
    return this.requestAppServer('experimentalFeature/list', params)
  }

  async listPermissionProfiles(params: Record<string, unknown> = {}) {
    return this.requestAppServer('permissionProfile/list', params)
  }

  async setExperimentalFeatureEnablement(params: Record<string, unknown>) {
    return this.requestAppServer('experimentalFeature/enablement/set', params)
  }

  async addEnvironment(params: Record<string, unknown>) {
    return this.requestAppServer('environment/add', params)
  }

  async listCollaborationModes() {
    return this.requestAppServer('collaborationMode/list')
  }

  async listSkills(params: Record<string, unknown> = {}) {
    return this.requestAppServer('skills/list', params)
  }

  async setSkillExtraRoots(roots: string[]) {
    return this.requestAppServer('skills/extraRoots/set', { roots })
  }

  async listHooks(params: Record<string, unknown> = {}) {
    return this.requestAppServer('hooks/list', params)
  }

  async addMarketplace(params: Record<string, unknown>) {
    return this.requestAppServer('marketplace/add', params)
  }

  async removeMarketplace(marketplaceName: string) {
    return this.requestAppServer('marketplace/remove', { marketplaceName })
  }

  async upgradeMarketplace(params: Record<string, unknown> = {}) {
    return this.requestAppServer('marketplace/upgrade', params)
  }

  async listPlugins(params: Record<string, unknown> = {}) {
    return this.requestAppServer('plugin/list', params)
  }

  async listInstalledPlugins(params: Record<string, unknown> = {}) {
    return this.requestAppServer('plugin/installed', params)
  }

  async readPlugin(params: Record<string, unknown>) {
    return this.requestAppServer('plugin/read', params)
  }

  async readPluginSkill(params: Record<string, unknown>) {
    return this.requestAppServer('plugin/skill/read', params)
  }

  async listApps(params: Record<string, unknown> = {}) {
    return this.requestAppServer('app/list', params)
  }

  async readAccount(refreshToken = false) {
    return this.requestAppServer('account/read', { refreshToken })
  }

  async startAccountLogin(params: CodexAccountLoginParams) {
    return this.requestAppServer('account/login/start', params)
  }

  async cancelAccountLogin(loginId: string) {
    return this.requestAppServer('account/login/cancel', { loginId })
  }

  async logoutAccount() {
    return this.requestAppServer('account/logout')
  }

  async readAccountRateLimits() {
    return this.requestAppServer('account/rateLimits/read')
  }

  async readAccountUsage(params: Record<string, unknown> = {}) {
    return this.requestAppServer('account/usage/read', params)
  }

  async sendAddCreditsNudgeEmail(
    creditType: CodexAddCreditsNudgeCreditType
  ) {
    return this.requestAppServer('account/sendAddCreditsNudgeEmail', {
      creditType,
    })
  }

  async enableRemoteControl() {
    return this.requestAppServer('remoteControl/enable')
  }

  async disableRemoteControl() {
    return this.requestAppServer('remoteControl/disable')
  }

  async readRemoteControlStatus() {
    return this.requestAppServer('remoteControl/status/read')
  }

  async startRemoteControlPairing(params: Record<string, unknown> = {}) {
    return this.requestAppServer('remoteControl/pairing/start', params)
  }

  async readRemoteControlPairingStatus(
    params: CodexRemotePairingStatusParams
  ) {
    return this.requestAppServer('remoteControl/pairing/status', params)
  }

  async listRemoteControlClients(params: Record<string, unknown>) {
    return this.requestAppServer('remoteControl/client/list', params)
  }

  async revokeRemoteControlClient(params: Record<string, unknown>) {
    return this.requestAppServer('remoteControl/client/revoke', params)
  }

  async writeSkillConfig(params: Record<string, unknown>) {
    return this.requestAppServer('skills/config/write', params)
  }

  async installPlugin(params: Record<string, unknown>) {
    return this.requestAppServer('plugin/install', params)
  }

  async uninstallPlugin(params: Record<string, unknown>) {
    return this.requestAppServer('plugin/uninstall', params)
  }

  async startMcpOauthLogin(server: string) {
    return this.requestAppServer('mcpServer/oauth/login', { server })
  }

  async requestUserInput(params: Record<string, unknown>) {
    return this.requestAppServer('tool/requestUserInput', params)
  }

  async listMcpServerStatus(params: Record<string, unknown> = {}) {
    return this.requestAppServer('mcpServerStatus/list', params)
  }

  async readMcpResource(params: Record<string, unknown>) {
    return this.requestAppServer('mcpServer/resource/read', params)
  }

  async callMcpTool(params: CodexMcpToolCallParams) {
    return this.requestAppServer('mcpServer/tool/call', params)
  }

  async startWindowsSandboxSetup(params: Record<string, unknown>) {
    return this.requestAppServer('windowsSandbox/setupStart', params)
  }

  async uploadFeedback(params: Record<string, unknown>) {
    return this.requestAppServer('feedback/upload', params)
  }

  async readConfig() {
    return this.requestAppServer('config/read')
  }

  async detectExternalAgentConfig(params: Record<string, unknown> = {}) {
    return this.requestAppServer('externalAgentConfig/detect', params)
  }

  async importExternalAgentConfig(params: Record<string, unknown>) {
    return this.requestAppServer('externalAgentConfig/import', params)
  }

  async writeConfigValue(keyPath: string, value: unknown) {
    return this.requestAppServer('config/value/write', { keyPath, value })
  }

  async batchWriteConfig(params: Record<string, unknown>) {
    return this.requestAppServer('config/batchWrite', params)
  }

  async readConfigRequirements() {
    return this.requestAppServer('configRequirements/read')
  }

  async listThreads(params: Record<string, unknown> = {}) {
    return this.requestAppServer('thread/list', params)
  }

  async listLoadedThreads() {
    return this.requestAppServer('thread/loaded/list')
  }

  async readThread(threadId: string, params: Record<string, unknown> = {}) {
    return this.requestAppServer('thread/read', { threadId, ...params })
  }

  async listThreadTurns(
    threadId: string,
    params: Record<string, unknown> = {}
  ) {
    return this.requestAppServer('thread/turns/list', { threadId, ...params })
  }

  async listThreadTurnItems(params: Record<string, unknown>) {
    return this.requestAppServer('thread/turns/items/list', params)
  }

  async forkThread(threadId: string, params: Record<string, unknown> = {}) {
    return this.requestAppServer('thread/fork', { threadId, ...params })
  }

  async updateThreadMetadata(
    threadId: string,
    params: Record<string, unknown>
  ) {
    return this.requestAppServer('thread/metadata/update', {
      threadId,
      ...params,
    })
  }

  async updateThreadSettings(
    threadId: string,
    settings: Record<string, unknown>
  ) {
    return this.requestAppServer('thread/settings/update', {
      threadId,
      settings,
    })
  }

  async setThreadMemoryMode(
    threadId: string,
    memoryMode: 'enabled' | 'disabled'
  ) {
    return this.requestAppServer('thread/memoryMode/set', {
      threadId,
      memoryMode,
    })
  }

  async resetMemory() {
    return this.requestAppServer('memory/reset')
  }

  async setThreadGoal(threadId: string, goal: Record<string, unknown>) {
    return this.requestAppServer('thread/goal/set', { threadId, goal })
  }

  async getThreadGoal(threadId: string) {
    return this.requestAppServer('thread/goal/get', { threadId })
  }

  async clearThreadGoal(threadId: string) {
    return this.requestAppServer('thread/goal/clear', { threadId })
  }

  async archiveThread(threadId: string) {
    return this.requestAppServer('thread/archive', { threadId })
  }

  async unsubscribeThread(threadId: string) {
    return this.requestAppServer('thread/unsubscribe', { threadId })
  }

  async setThreadName(threadId: string, name: string) {
    return this.requestAppServer('thread/name/set', { threadId, name })
  }

  async unarchiveThread(threadId: string) {
    return this.requestAppServer('thread/unarchive', { threadId })
  }

  async injectThreadItems(threadId: string, items: unknown[]) {
    return this.requestAppServer('thread/inject_items', { threadId, items })
  }

  async cleanBackgroundTerminals(threadId: string) {
    return this.requestAppServer('thread/backgroundTerminals/clean', {
      threadId,
    })
  }

  async startThreadRealtime(
    threadId: string,
    params: CodexRealtimeStartParams = {}
  ) {
    return this.requestAppServer('thread/realtime/start', {
      threadId,
      ...params,
    })
  }

  async appendThreadRealtimeAudio(threadId: string, audioBase64: string) {
    return this.requestAppServer('thread/realtime/appendAudio', {
      threadId,
      audioBase64,
    })
  }

  async appendThreadRealtimeText(threadId: string, text: string) {
    return this.requestAppServer('thread/realtime/appendText', {
      threadId,
      text,
    })
  }

  async stopThreadRealtime(threadId: string) {
    return this.requestAppServer('thread/realtime/stop', { threadId })
  }

  /**
   * Steer / send follow-up input to a specific Codex thread (e.g. a subagent child thread).
   * This appends to the active turn for that thread using turn/steer.
   * Useful for "opening up" a subagent and giving it additional instructions without affecting the parent.
   */
  steerThread(
    targetThreadId: string,
    text: string,
    clientUserMessageId?: string,
    images?: Array<{ data: string; mediaType: string }>
  ) {
    return this.manager.rpc.request('turn/steer', {
      threadId: targetThreadId,
      clientUserMessageId: clientUserMessageId ?? null,
      input: buildSteerInput(text, images),
    })
  }

  /**
   * Steer a subagent thread and stream Codex notifications until that thread's turn completes.
   * Used by the subagent inspector so steer responses appear live (not only in a later chat turn).
   */
  async *steerThreadWithEvents(
    targetThreadId: string,
    text: string,
    clientUserMessageId?: string,
    images?: Array<{ data: string; mediaType: string }>
  ): AsyncGenerator<CodexAppServerEvent> {
    await this.initialize()

    const queue = createEventQueue()
    const unsubscriptions: Unsubscribe[] = [
      this.manager.rpc.onNotification((message) => {
        const event = mapNotificationToEvent(message)
        if (!event) return
        queue.push(event)
      }),
      this.manager.rpc.onServerRequest((request) => {
        queue.push(mapServerRequestToEvent(request))
      }),
      this.manager.rpc.onError((error) => queue.push({ type: 'error', error })),
    ]

    try {
      await this.manager.rpc.request('turn/steer', {
        threadId: targetThreadId,
        clientUserMessageId: clientUserMessageId ?? null,
        input: buildSteerInput(text, images),
      })

      let completed = false
      while (!completed) {
        const event = await queue.next()
        yield event
        if (event.type === 'error') {
          completed = true
          continue
        }
        if (
          event.type === 'turn_completed' &&
          'threadId' in event &&
          event.threadId === targetThreadId
        ) {
          completed = true
        }
      }
    } finally {
      unsubscriptions.forEach((unsubscribe) => unsubscribe())
    }
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

  async requestAppServer<T = unknown>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    await this.initialize()
    return this.manager.rpc.request(method, params)
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
      const response = await this.manager.rpc.request<ThreadResumeResponse>(
        'thread/resume',
        {
          threadId: existing.codexThreadId,
          ...buildThreadStartParams(this.params.options),
        }
      )
      existing.loadedGeneration = this.manager.generation
      this.threadPayloads.set(appThreadId, response.thread)
      return existing
    }

    const response = await this.manager.rpc.request<ThreadStartResponse>(
      'thread/start',
      {
        ...buildThreadStartParams(this.params.options),
        ephemeral: false,
      }
    )
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

  if (message.method === 'thread/settings/updated') {
    return {
      type: 'thread_settings_updated',
      threadId: String(params.threadId),
      threadSettings: params.threadSettings,
    }
  }

  if (message.method === 'thread/archived') {
    return {
      type: 'thread_archived',
      threadId: String(params.threadId),
      thread: params.thread,
    }
  }

  if (message.method === 'thread/unarchived') {
    return {
      type: 'thread_unarchived',
      threadId: String(params.threadId),
      thread: params.thread,
    }
  }

  if (message.method === 'thread/name/updated') {
    return {
      type: 'thread_name_updated',
      threadId: String(params.threadId),
      name: String(params.name ?? ''),
    }
  }

  if (message.method === 'thread/closed') {
    return {
      type: 'thread_closed',
      threadId: String(params.threadId),
    }
  }

  if (message.method === 'thread/goal/updated') {
    return {
      type: 'thread_goal_updated',
      threadId: String(params.threadId),
      goal: params.goal,
    }
  }

  if (message.method === 'thread/goal/cleared') {
    return {
      type: 'thread_goal_cleared',
      threadId: String(params.threadId),
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
      summaryIndex:
        params.summaryIndex === undefined
          ? undefined
          : numberValue(params.summaryIndex),
      contentIndex:
        params.contentIndex === undefined
          ? undefined
          : numberValue(params.contentIndex),
    }
  }

  if (message.method === 'item/reasoning/summaryPartAdded') {
    return {
      type: 'reasoning_part_added',
      threadId: String(params.threadId),
      turnId: String(params.turnId),
      itemId: String(params.itemId),
      summaryIndex:
        params.summaryIndex === undefined
          ? undefined
          : numberValue(params.summaryIndex),
      contentIndex:
        params.contentIndex === undefined
          ? undefined
          : numberValue(params.contentIndex),
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

  if (message.method === 'command/exec/outputDelta') {
    return {
      type: 'process_output_delta',
      processHandle: String(params.processId),
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

  if (message.method === 'fs/changed') {
    return {
      type: 'fs_changed',
      watchId: String(params.watchId ?? ''),
      changedPaths: Array.isArray(params.changedPaths)
        ? params.changedPaths.map((path) => String(path))
        : [],
    }
  }

  if (message.method === 'account/login/completed') {
    return {
      type: 'account_login_completed',
      loginId: stringValue(params.loginId),
      success: Boolean(params.success),
      error: params.error,
      params,
    }
  }

  if (message.method === 'account/updated') {
    return {
      type: 'account_updated',
      authMode: stringValue(params.authMode) ?? null,
      planType: stringValue(params.planType) ?? null,
      params,
    }
  }

  if (message.method === 'account/rateLimits/updated') {
    return {
      type: 'account_rate_limits_updated',
      rateLimits: params.rateLimits,
      individualLimit: params.individualLimit,
      params,
    }
  }

  if (message.method === 'mcpServer/oauthLogin/completed') {
    return {
      type: 'mcp_oauth_login_completed',
      name: String(params.name ?? ''),
      success: Boolean(params.success),
      error: params.error,
      params,
    }
  }

  if (message.method === 'mcpServer/startupStatus/updated') {
    return {
      type: 'mcp_startup_status_updated',
      threadId: stringValue(params.threadId),
      name: String(params.name ?? ''),
      status: String(params.status ?? ''),
      error: params.error,
      params,
    }
  }

  if (message.method === 'remoteControl/status/changed') {
    return {
      type: 'remote_control_status_changed',
      status: String(params.status ?? ''),
      serverName: stringValue(params.serverName),
      environmentId: stringValue(params.environmentId),
      params,
    }
  }

  if (message.method === 'turn/diff/updated') {
    return {
      type: 'turn_diff_updated',
      threadId: stringValue(params.threadId),
      turnId: stringValue(params.turnId),
      diff: params.diff ?? params,
      params,
    }
  }

  if (message.method === 'turn/plan/updated') {
    return {
      type: 'turn_plan_updated',
      threadId: stringValue(params.threadId),
      turnId: stringValue(params.turnId),
      plan: params.plan ?? params,
      params,
    }
  }

  if (message.method === 'model/rerouted') {
    return {
      type: 'model_rerouted',
      threadId: stringValue(params.threadId),
      turnId: stringValue(params.turnId),
      fromModel:
        stringValue(params.fromModel) ??
        stringValue(params.requestedModel) ??
        stringValue(params.originalModel),
      toModel:
        stringValue(params.toModel) ??
        stringValue(params.model) ??
        stringValue(params.selectedModel),
      reason: params.reason,
      params,
    }
  }

  if (message.method === 'model/verification') {
    return {
      type: 'model_verification',
      threadId: stringValue(params.threadId),
      turnId: stringValue(params.turnId),
      status: stringValue(params.status),
      params,
    }
  }

  if (message.method === 'turn/moderationMetadata') {
    return {
      type: 'turn_moderation_metadata',
      threadId: stringValue(params.threadId),
      turnId: stringValue(params.turnId),
      metadata: params.metadata ?? params.moderationMetadata ?? params,
      params,
    }
  }

  if (message.method.startsWith('item/autoApprovalReview/')) {
    return {
      type: 'auto_approval_review_event',
      method: message.method,
      threadId: stringValue(params.threadId),
      turnId: stringValue(params.turnId),
      itemId: stringValue(params.itemId),
      params,
    }
  }

  if (message.method === 'warning') {
    return {
      type: 'warning',
      message: String(params.message ?? 'Codex app-server warning'),
      threadId: stringValue(params.threadId),
    }
  }

  if (
    message.method === 'skills/changed' ||
    message.method === 'skills_changed' ||
    message.method === 'skills/config/changed'
  ) {
    return {
      type: 'skills_changed',
      threadId: stringValue(params.threadId),
      skills: params.skills ?? params,
      changed: params,
    }
  }

  if (message.method === 'plugins/changed' || message.method === 'plugin/installed' || message.method === 'plugin/uninstalled') {
    return {
      type: 'plugins_changed',
      threadId: stringValue(params.threadId),
      plugins: params.plugins ?? params,
      changed: params,
    }
  }

  if (message.method === 'hooks/changed' || message.method === 'hooks/list') {
    return {
      type: 'hooks_changed',
      threadId: stringValue(params.threadId),
      hooks: params,
    }
  }

  if (message.method === 'serverRequest/resolved') {
    return {
      type: 'server_request_resolved',
      requestId:
        requestIdValue(params.requestId) ?? requestIdValue(params.id) ?? '',
      threadId: stringValue(params.threadId),
      params,
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
  method === 'item/commandExecution/requestApproval' ||
  method === 'item/fileChange/requestApproval' ||
  method === 'execCommandApproval' ||
  method === 'applyPatchApproval' ||
  method === 'mcpServer/elicitation/request'

const buildSteerInput = (
  text: string,
  images?: Array<{ data: string; mediaType: string }>
): CodexInputItem[] => {
  const input: CodexInputItem[] = []
  if (text) {
    input.push({ type: 'text', text, text_elements: [] })
  }
  if (images && images.length > 0) {
    for (const img of images) {
      input.push({
        type: 'image',
        image: { data: img.data, media_type: img.mediaType },
      })
    }
  }
  return input
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

const requestIdValue = (value: unknown): CodexRequestId | undefined =>
  typeof value === 'string' || typeof value === 'number' ? value : undefined

const normalizePositiveTurnCount = (value: number) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 1
