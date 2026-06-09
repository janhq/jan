import { CodexAppServerSession } from './client'
import { CodexProtoSession } from './proto-session'
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
  images?: Array<{ data: string; mediaType: string }>
}

export type CodexReviewTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title?: string }
  | { type: 'custom'; instructions: string }

export type CodexReviewOptions = {
  /** @deprecated Use the git-diff review panel (ReviewSection) in the agent workspace instead of 'inline'.
   * The panel is the authoritative git diff view; agent provides analysis/findings on top only.
   */
  delivery?: 'inline' | 'detached'
  userFacingHint?: string
}

/**
 * Note: 'inline' delivery for review is deprecated in favor of the dedicated git-diff based
 * review panel in the agent workspace (ModelToolsPanel ReviewSection and /review route).
 * The agent must NEVER be the source of the diff content. Use the git review panel as the
 * authoritative view; the agent can provide additional findings/analysis on top of the real
 * git diff (e.g. via userFacingHint or by the panel surfacing agent output).
 * Default to 'detached' to avoid adding review findings to the chat stream ("a spot").
 */

export type CodexCommandExecParams = {
  command: string[]
  processId?: string
  cwd?: string
  env?: Record<string, string | null>
  size?: { rows: number; cols: number }
  permissionProfile?: string
  outputBytesCap?: number
  timeoutMs?: number
  disableOutputCap?: boolean
  disableTimeout?: boolean
  tty?: boolean
  streamStdin?: boolean
  streamStdoutStderr?: boolean
}

export type CodexProcessSpawnParams = {
  command: string[]
  processHandle?: string
  cwd?: string
  env?: Record<string, string | null>
  size?: { rows: number; cols: number }
  outputBytesCap?: number | null
  timeoutMs?: number | null
  tty?: boolean
  streamStdin?: boolean
  streamStdoutStderr?: boolean
}

export type CodexFileSystemMetadata = {
  isDirectory: boolean
  isFile: boolean
  isSymlink: boolean
  createdAtMs: number
  modifiedAtMs: number
}

export type CodexFileSystemDirectoryEntry = {
  fileName: string
  isDirectory: boolean
  isFile: boolean
}

export type CodexFileSystemCopyParams = {
  sourcePath: string
  destinationPath: string
  recursive?: boolean
}

export type CodexFileSystemRemoveParams = {
  path: string
  recursive?: boolean
  force?: boolean
}

export type CodexRemotePairingStatusParams = {
  pairingCode?: string
  manualPairingCode?: string
}

export type CodexMcpToolCallParams = {
  threadId?: string
  server: string
  tool: string
  arguments?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

export type CodexRealtimeStartParams = Record<string, unknown>

export type CodexAccountLoginParams =
  | { type: 'apiKey'; apiKey: string }
  | { type: 'chatgpt' }
  | { type: 'chatgptDeviceCode' }
  | Record<string, unknown>

export type CodexAddCreditsNudgeCreditType = 'credits' | 'usage_limit'

export class CodexAppServerClient {
  private readonly session: CodexAppServerSession | CodexProtoSession

  constructor(params: StartCodexSessionParams) {
    this.session =
      params.options.transport === 'proto'
        ? new CodexProtoSession(params)
        : new CodexAppServerSession(params)
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
      images: options.images,
    })
  }

  interruptTurn(threadId: string) {
    return this.session.interruptTurn(threadId)
  }

  compactThread(threadId: string) {
    return this.session.compactThread(threadId)
  }

  reloadUserConfig() {
    return this.session.reloadUserConfig()
  }

  refreshMcpServers() {
    return this.session.refreshMcpServers()
  }

  runShellCommand(threadId: string, command: string) {
    return this.session.runShellCommand(threadId, command)
  }

  rollbackThread(threadId: string, numTurns = 1) {
    return this.session.rollbackThread(threadId, numTurns)
  }

  startReview(
    threadId: string,
    target: CodexReviewTarget,
    options: CodexReviewOptions = {}
  ) {
    // Force detached for review to route through the real git-diff review panel in the
    // agent workspace side panel. Inline would add findings to the chat as "agent added to a spot".
    const opts = { ...options, delivery: options.delivery ?? 'detached' }
    return this.session.startReview(threadId, target, opts)
  }

  execCommand(params: CodexCommandExecParams) {
    return this.session.execCommand(params)
  }

  writeCommandStdin(
    processId: string,
    input: { deltaBase64?: string; closeStdin?: boolean }
  ) {
    return this.session.writeCommandStdin(processId, input)
  }

  resizeCommandPty(processId: string, size: { rows: number; cols: number }) {
    return this.session.resizeCommandPty(processId, size)
  }

  terminateCommand(processId: string) {
    return this.session.terminateCommand(processId)
  }

  spawnProcess(params: CodexProcessSpawnParams) {
    return this.session.spawnProcess(params)
  }

  writeProcessStdin(
    processHandle: string,
    input: { deltaBase64?: string; closeStdin?: boolean }
  ) {
    return this.session.writeProcessStdin(processHandle, input)
  }

  resizeProcessPty(
    processHandle: string,
    size: { rows: number; cols: number }
  ) {
    return this.session.resizeProcessPty(processHandle, size)
  }

  killProcess(processHandle: string) {
    return this.session.killProcess(processHandle)
  }

  readFile(path: string): Promise<{ dataBase64: string }> {
    return this.session.readFile(path)
  }

  writeFile(path: string, dataBase64: string): Promise<Record<string, never>> {
    return this.session.writeFile(path, dataBase64)
  }

  createDirectory(
    path: string,
    recursive?: boolean
  ): Promise<Record<string, never>> {
    return this.session.createDirectory(path, recursive)
  }

  getMetadata(path: string): Promise<CodexFileSystemMetadata> {
    return this.session.getMetadata(path)
  }

  readDirectory(path: string): Promise<{
    entries: CodexFileSystemDirectoryEntry[]
  }> {
    return this.session.readDirectory(path)
  }

  removeFileSystemPath(
    params: CodexFileSystemRemoveParams
  ): Promise<Record<string, never>> {
    return this.session.removeFileSystemPath(params)
  }

  copyFileSystemPath(
    params: CodexFileSystemCopyParams
  ): Promise<Record<string, never>> {
    return this.session.copyFileSystemPath(params)
  }

  watchFileSystem(
    watchId: string,
    path: string
  ): Promise<{ path: string }> {
    return this.session.watchFileSystem(watchId, path)
  }

  unwatchFileSystem(watchId: string): Promise<Record<string, never>> {
    return this.session.unwatchFileSystem(watchId)
  }

  listModels(params: Record<string, unknown> = {}) {
    return this.session.listModels(params)
  }

  readModelProviderCapabilities(params: Record<string, unknown> = {}) {
    return this.session.readModelProviderCapabilities(params)
  }

  listExperimentalFeatures(params: Record<string, unknown> = {}) {
    return this.session.listExperimentalFeatures(params)
  }

  listPermissionProfiles(params: Record<string, unknown> = {}) {
    return this.session.listPermissionProfiles(params)
  }

  setExperimentalFeatureEnablement(params: Record<string, unknown>) {
    return this.session.setExperimentalFeatureEnablement(params)
  }

  addEnvironment(params: Record<string, unknown>) {
    return this.session.addEnvironment(params)
  }

  listCollaborationModes() {
    return this.session.listCollaborationModes()
  }

  listSkills(params: Record<string, unknown> = {}) {
    return this.session.listSkills(params)
  }

  setSkillExtraRoots(roots: string[]) {
    return this.session.setSkillExtraRoots(roots)
  }

  listHooks(params: Record<string, unknown> = {}) {
    return this.session.listHooks(params)
  }

  addMarketplace(params: Record<string, unknown>) {
    return this.session.addMarketplace(params)
  }

  removeMarketplace(marketplaceName: string) {
    return this.session.removeMarketplace(marketplaceName)
  }

  upgradeMarketplace(params: Record<string, unknown> = {}) {
    return this.session.upgradeMarketplace(params)
  }

  listPlugins(params: Record<string, unknown> = {}) {
    return this.session.listPlugins(params)
  }

  listInstalledPlugins(params: Record<string, unknown> = {}) {
    return this.session.listInstalledPlugins(params)
  }

  readPlugin(params: Record<string, unknown>) {
    return this.session.readPlugin(params)
  }

  readPluginSkill(params: Record<string, unknown>) {
    return this.session.readPluginSkill(params)
  }

  listApps(params: Record<string, unknown> = {}) {
    return this.session.listApps(params)
  }

  readAccount(refreshToken = false) {
    return this.session.readAccount(refreshToken)
  }

  startAccountLogin(params: CodexAccountLoginParams) {
    return this.session.startAccountLogin(params)
  }

  cancelAccountLogin(loginId: string) {
    return this.session.cancelAccountLogin(loginId)
  }

  logoutAccount() {
    return this.session.logoutAccount()
  }

  readAccountRateLimits() {
    return this.session.readAccountRateLimits()
  }

  readAccountUsage(params: Record<string, unknown> = {}) {
    return this.session.readAccountUsage(params)
  }

  sendAddCreditsNudgeEmail(creditType: CodexAddCreditsNudgeCreditType) {
    return this.session.sendAddCreditsNudgeEmail(creditType)
  }

  enableRemoteControl() {
    return this.session.enableRemoteControl()
  }

  disableRemoteControl() {
    return this.session.disableRemoteControl()
  }

  readRemoteControlStatus() {
    return this.session.readRemoteControlStatus()
  }

  startRemoteControlPairing(params: Record<string, unknown> = {}) {
    return this.session.startRemoteControlPairing(params)
  }

  readRemoteControlPairingStatus(params: CodexRemotePairingStatusParams) {
    return this.session.readRemoteControlPairingStatus(params)
  }

  listRemoteControlClients(params: Record<string, unknown>) {
    return this.session.listRemoteControlClients(params)
  }

  revokeRemoteControlClient(params: Record<string, unknown>) {
    return this.session.revokeRemoteControlClient(params)
  }

  writeSkillConfig(params: Record<string, unknown>) {
    return this.session.writeSkillConfig(params)
  }

  installPlugin(params: Record<string, unknown>) {
    return this.session.installPlugin(params)
  }

  uninstallPlugin(params: Record<string, unknown>) {
    return this.session.uninstallPlugin(params)
  }

  startMcpOauthLogin(server: string) {
    return this.session.startMcpOauthLogin(server)
  }

  requestUserInput(params: Record<string, unknown>) {
    return this.session.requestUserInput(params)
  }

  listMcpServerStatus(params: Record<string, unknown> = {}) {
    return this.session.listMcpServerStatus(params)
  }

  readMcpResource(params: Record<string, unknown>) {
    return this.session.readMcpResource(params)
  }

  callMcpTool(params: CodexMcpToolCallParams) {
    return this.session.callMcpTool(params)
  }

  startWindowsSandboxSetup(params: Record<string, unknown>) {
    return this.session.startWindowsSandboxSetup(params)
  }

  uploadFeedback(params: Record<string, unknown>) {
    return this.session.uploadFeedback(params)
  }

  readConfig() {
    return this.session.readConfig()
  }

  detectExternalAgentConfig(params: Record<string, unknown> = {}) {
    return this.session.detectExternalAgentConfig(params)
  }

  importExternalAgentConfig(params: Record<string, unknown>) {
    return this.session.importExternalAgentConfig(params)
  }

  writeConfigValue(keyPath: string, value: unknown) {
    return this.session.writeConfigValue(keyPath, value)
  }

  batchWriteConfig(params: Record<string, unknown>) {
    return this.session.batchWriteConfig(params)
  }

  readConfigRequirements() {
    return this.session.readConfigRequirements()
  }

  requestAppServer(method: string, params?: Record<string, unknown>) {
    return this.session.requestAppServer(method, params)
  }

  listThreads(params: Record<string, unknown> = {}) {
    return this.session.listThreads(params)
  }

  listLoadedThreads() {
    return this.session.listLoadedThreads()
  }

  readThread(threadId: string, params: Record<string, unknown> = {}) {
    return this.session.readThread(threadId, params)
  }

  listThreadTurns(threadId: string, params: Record<string, unknown> = {}) {
    return this.session.listThreadTurns(threadId, params)
  }

  listThreadTurnItems(params: Record<string, unknown>) {
    return this.session.listThreadTurnItems(params)
  }

  forkThread(threadId: string, params: Record<string, unknown> = {}) {
    return this.session.forkThread(threadId, params)
  }

  updateThreadMetadata(threadId: string, params: Record<string, unknown>) {
    return this.session.updateThreadMetadata(threadId, params)
  }

  updateThreadSettings(threadId: string, settings: Record<string, unknown>) {
    return this.session.updateThreadSettings(threadId, settings)
  }

  setThreadMemoryMode(threadId: string, memoryMode: 'enabled' | 'disabled') {
    return this.session.setThreadMemoryMode(threadId, memoryMode)
  }

  resetMemory() {
    return this.session.resetMemory()
  }

  setThreadGoal(threadId: string, goal: Record<string, unknown>) {
    return this.session.setThreadGoal(threadId, goal)
  }

  getThreadGoal(threadId: string) {
    return this.session.getThreadGoal(threadId)
  }

  clearThreadGoal(threadId: string) {
    return this.session.clearThreadGoal(threadId)
  }

  archiveThread(threadId: string) {
    return this.session.archiveThread(threadId)
  }

  unsubscribeThread(threadId: string) {
    return this.session.unsubscribeThread(threadId)
  }

  setThreadName(threadId: string, name: string) {
    return this.session.setThreadName(threadId, name)
  }

  unarchiveThread(threadId: string) {
    return this.session.unarchiveThread(threadId)
  }

  injectThreadItems(threadId: string, items: unknown[]) {
    return this.session.injectThreadItems(threadId, items)
  }

  cleanBackgroundTerminals(threadId: string) {
    return this.session.cleanBackgroundTerminals(threadId)
  }

  startThreadRealtime(threadId: string, params: CodexRealtimeStartParams = {}) {
    return this.session.startThreadRealtime(threadId, params)
  }

  appendThreadRealtimeAudio(threadId: string, audioBase64: string) {
    return this.session.appendThreadRealtimeAudio(threadId, audioBase64)
  }

  appendThreadRealtimeText(threadId: string, text: string) {
    return this.session.appendThreadRealtimeText(threadId, text)
  }

  stopThreadRealtime(threadId: string) {
    return this.session.stopThreadRealtime(threadId)
  }

  /**
   * Steer a specific Codex thread (supports subagent threads discovered via events).
   * Allows giving additional instructions directly to a running subagent.
   */
  steerThread(
    targetThreadId: string,
    text: string,
    clientUserMessageId?: string,
    images?: Array<{ data: string; mediaType: string }>
  ) {
    return this.session.steerThread(
      targetThreadId,
      text,
      clientUserMessageId,
      images
    )
  }

  steerThreadWithEvents(
    targetThreadId: string,
    text: string,
    clientUserMessageId?: string,
    images?: Array<{ data: string; mediaType: string }>
  ) {
    if (!('steerThreadWithEvents' in this.session)) {
      throw new Error(
        'Steer event streaming is only available with Codex app-server transport'
      )
    }
    return (
      this.session as CodexAppServerSession
    ).steerThreadWithEvents(
      targetThreadId,
      text,
      clientUserMessageId,
      images
    )
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
