import { describe, expect, it } from 'vitest'
import { startCodexSession } from '../api'
import type { CodexProcess, CodexProcessExit, Unsubscribe } from '../types'
import type { CodexProcessSpawner } from '../process-manager'

class ScriptedCodexProcess implements CodexProcess {
  writes: unknown[] = []

  private stdoutListeners = new Set<(line: string) => void>()
  private stderrListeners = new Set<(line: string) => void>()
  private exitListeners = new Set<(exit: CodexProcessExit) => void>()

  writeLine(line: string) {
    const message = JSON.parse(line)
    this.writes.push(message)
    this.respondToClientMessage(message)
  }

  onStdoutLine(callback: (line: string) => void): Unsubscribe {
    this.stdoutListeners.add(callback)
    return () => this.stdoutListeners.delete(callback)
  }

  onStderrLine(callback: (line: string) => void): Unsubscribe {
    this.stderrListeners.add(callback)
    return () => this.stderrListeners.delete(callback)
  }

  onExit(callback: (exit: CodexProcessExit) => void): Unsubscribe {
    this.exitListeners.add(callback)
    return () => this.exitListeners.delete(callback)
  }

  kill() {
    this.exitListeners.forEach((callback) => callback({ code: 0 }))
  }

  private respondToClientMessage(message: {
    id?: number | string
    method?: string
    params?: unknown
  }) {
    if (message.method === 'initialize') {
      this.emit({ id: message.id, result: { userAgent: 'codex-test' } })
    }

    if (message.method === 'thread/start') {
      this.emit({
        id: message.id,
        result: { thread: { id: 'codex-thread-1' } },
      })
    }

    if (message.method === 'turn/start') {
      this.emit({ id: message.id, result: { turn: { id: 'turn-1' } } })
      this.emit({
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'assistant-1',
          delta: 'hello',
        },
      })
      this.emit({
        id: 'approval-1',
        method: 'item/commandExecution/requestApproval',
        params: { command: 'pwd' },
      })
      this.emit({
        method: 'fs/changed',
        params: {
          watchId: 'watch-1',
          changedPaths: ['/repo/package.json'],
        },
      })
      this.emit({
        method: 'account/updated',
        params: { authMode: 'chatgpt', planType: 'plus' },
      })
      this.emit({
        method: 'account/rateLimits/updated',
        params: { rateLimits: { primary: { usedPercent: 25 } } },
      })
      this.emit({
        method: 'mcpServer/oauthLogin/completed',
        params: { name: 'fetch', success: true, error: null },
      })
      this.emit({
        method: 'mcpServer/startupStatus/updated',
        params: {
          threadId: 'codex-thread-1',
          name: 'fetch',
          status: 'ready',
          error: null,
        },
      })
      this.emit({
        method: 'turn/completed',
        params: {
          threadId: 'codex-thread-1',
          turn: { id: 'turn-1', status: 'completed' },
        },
      })
    }

    if (message.method === 'turn/interrupt') {
      this.emit({ id: message.id, result: { interrupted: true } })
    }

    if (message.method === 'thread/compact/start') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'config/batchWrite') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'config/value/write') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'config/mcpServer/reload') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'thread/shellCommand') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'thread/rollback') {
      this.emit({
        id: message.id,
        result: { thread: { id: 'codex-thread-1', turns: [] } },
      })
    }

    if (message.method === 'review/start') {
      this.emit({
        id: message.id,
        result: {
          turn: { id: 'review-turn-1', status: 'running' },
          reviewThreadId: 'codex-thread-1',
        },
      })
    }

    if (message.method === 'command/exec') {
      this.emit({
        id: message.id,
        result: { exitCode: 0, stdout: 'ok', stderr: '' },
      })
    }

    if (message.method === 'command/exec/write') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'command/exec/resize') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'command/exec/terminate') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'process/spawn') {
      this.emit({
        id: message.id,
        result: { processHandle: 'proc-1', pid: 123 },
      })
    }

    if (message.method === 'process/writeStdin') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'process/resizePty') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'process/kill') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'fs/readFile') {
      this.emit({ id: message.id, result: { dataBase64: 'aGVsbG8=' } })
    }

    if (message.method === 'fs/writeFile') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'fs/createDirectory') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'fs/getMetadata') {
      this.emit({
        id: message.id,
        result: {
          isDirectory: false,
          isFile: true,
          isSymlink: false,
          createdAtMs: 1,
          modifiedAtMs: 2,
        },
      })
    }

    if (message.method === 'fs/readDirectory') {
      this.emit({
        id: message.id,
        result: {
          entries: [{ fileName: 'package.json', isDirectory: false, isFile: true }],
        },
      })
    }

    if (message.method === 'fs/remove') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'fs/copy') {
      this.emit({ id: message.id, result: {} })
    }

    if (message.method === 'fs/watch') {
      this.emit({ id: message.id, result: { path: '/repo/package.json' } })
    }

    if (message.method === 'fs/unwatch') {
      this.emit({ id: message.id, result: {} })
    }

    const appServerUtilityResults: Record<string, unknown> = {
      'model/list': { models: [{ id: 'gpt-test' }] },
      'modelProvider/capabilities/read': { capabilities: { supportsReasoning: true } },
      'experimentalFeature/list': { features: [] },
      'permissionProfile/list': { profiles: [{ id: ':workspace' }] },
      'experimentalFeature/enablement/set': {},
      'environment/add': {},
      'collaborationMode/list': { modes: [{ id: 'default' }] },
      'skills/list': { skills: [] },
      'skills/extraRoots/set': {},
      'hooks/list': { hooks: [] },
      'marketplace/add': { root: '/repo/.codex/plugins/custom', alreadyPresent: false },
      'marketplace/remove': {},
      'marketplace/upgrade': { marketplaces: ['custom'] },
      'plugin/list': { plugins: [] },
      'plugin/installed': { plugins: [] },
      'plugin/read': { plugin: { name: 'foo' } },
      'plugin/skill/read': { markdown: '# Skill' },
      'app/list': { apps: [] },
      'account/read': {
        account: { type: 'chatgpt', email: 'user@example.com' },
        requiresOpenaiAuth: true,
      },
      'account/login/start': {
        type: 'chatgptDeviceCode',
        loginId: 'login-1',
        verificationUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-1234',
      },
      'account/login/cancel': {},
      'account/logout': {},
      'account/rateLimits/read': {
        rateLimits: { primary: { usedPercent: 25 } },
      },
      'account/usage/read': { buckets: [] },
      'account/sendAddCreditsNudgeEmail': { status: 'sent' },
      'remoteControl/enable': { status: 'connecting' },
      'remoteControl/disable': { status: 'disabled' },
      'remoteControl/status/read': { status: 'disabled' },
      'remoteControl/pairing/start': {
        pairingCode: 'pair-1',
        manualPairingCode: '123456',
        environmentId: 'env-1',
        expiresAt: 1,
      },
      'remoteControl/pairing/status': { claimed: false },
      'remoteControl/client/list': { clients: [], nextCursor: null },
      'remoteControl/client/revoke': {},
      'skills/config/write': {},
      'plugin/install': { pluginId: 'foo@official' },
      'plugin/uninstall': {},
      'mcpServer/oauth/login': {
        authorization_url: 'https://example.com/oauth',
      },
      'tool/requestUserInput': { answers: { confirm: 'yes' } },
      'mcpServerStatus/list': { servers: [] },
      'mcpServer/resource/read': { contents: [] },
      'mcpServer/tool/call': { content: [] },
      'windowsSandbox/setupStart': { started: true },
      'feedback/upload': { threadId: 'feedback-1' },
      'config/read': { config: {} },
      'externalAgentConfig/detect': { migrationItems: [] },
      'externalAgentConfig/import': {},
      'configRequirements/read': { requirements: null },
      'thread/list': { threads: [{ id: 'codex-thread-1' }] },
      'thread/loaded/list': { threadIds: ['codex-thread-1'] },
      'thread/read': { thread: { id: 'codex-thread-1' } },
      'thread/turns/list': { turns: [], nextCursor: null },
      'thread/turns/items/list': { items: [] },
      'thread/fork': { thread: { id: 'codex-thread-fork' } },
      'thread/metadata/update': { thread: { id: 'codex-thread-1' } },
      'thread/settings/update': {},
      'thread/memoryMode/set': {},
      'memory/reset': {},
      'thread/goal/set': { goal: { objective: 'ship codex clone' } },
      'thread/goal/get': { goal: { objective: 'ship codex clone' } },
      'thread/goal/clear': { removed: true },
      'thread/archive': {},
      'thread/unsubscribe': {},
      'thread/name/set': {},
      'thread/unarchive': { thread: { id: 'codex-thread-1' } },
      'thread/inject_items': {},
      'thread/backgroundTerminals/clean': {},
      'thread/realtime/start': {},
      'thread/realtime/appendAudio': {},
      'thread/realtime/appendText': {},
      'thread/realtime/stop': {},
    }

    if (
      message.method &&
      Object.prototype.hasOwnProperty.call(appServerUtilityResults, message.method)
    ) {
      this.emit({ id: message.id, result: appServerUtilityResults[message.method] })
    }
  }

  private emit(value: unknown) {
    const line = JSON.stringify(value)
    this.stdoutListeners.forEach((callback) => callback(line))
  }
}

describe('Codex app-server integration API', () => {
  it('hides session internals behind start/send/approve/interrupt/shutdown methods', async () => {
    const process = new ScriptedCodexProcess()
    const spawner: CodexProcessSpawner = {
      spawn() {
        return process
      },
    }

    const client = await startCodexSession({
      spawner,
      options: {
        cwd: '/repo',
        model: 'gpt-test',
        modelProvider: 'openai',
        approvalPolicy: 'on-request',
        mcpRefreshConfig: {
          mcp_servers: {
            fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
          },
          mcp_oauth_credentials_store_mode: 'auto',
        },
      },
    })

    const events = []
    for await (const event of client.sendToCodex('jan-thread-1', 'say hello', {
      clientUserMessageId: 'user-message-1',
    })) {
      events.push(event)
    }

    client.approveAction('approval-1', { decision: 'approved' })
    await client.interruptTurn('jan-thread-1')
    await client.compactThread('jan-thread-1')
    await client.reloadUserConfig()
    await client.refreshMcpServers()
    await client.runShellCommand('jan-thread-1', 'git status --short')
    await client.rollbackThread('jan-thread-1', 2)
    await client.startReview(
      'jan-thread-1',
      { type: 'commit', sha: 'abc1234', title: 'Polish colors' },
      { delivery: 'detached', userFacingHint: 'review this commit' } // detached to use git review panel
    )
    await client.execCommand({
      command: ['git', 'status', '--short'],
      processId: 'git-status-1',
      cwd: '/repo',
      tty: true,
      streamStdin: true,
      streamStdoutStderr: true,
    })
    await client.writeCommandStdin('git-status-1', {
      deltaBase64: 'cHdkCg==',
    })
    await client.resizeCommandPty('git-status-1', { rows: 48, cols: 120 })
    await client.terminateCommand('git-status-1')
    await client.spawnProcess({
      command: ['node', '-v'],
      processHandle: 'proc-1',
      cwd: '/repo',
      tty: true,
      streamStdin: true,
      streamStdoutStderr: true,
    })
    await client.writeProcessStdin('proc-1', { deltaBase64: 'Cg==' })
    await client.resizeProcessPty('proc-1', { rows: 24, cols: 80 })
    await client.killProcess('proc-1')
    await client.readFile('/repo/package.json')
    await client.writeFile('/repo/package.json', 'e30=')
    await client.createDirectory('/repo/tmp/nested', true)
    await client.getMetadata('/repo/package.json')
    await client.readDirectory('/repo')
    await client.removeFileSystemPath({
      path: '/repo/tmp',
      recursive: true,
      force: true,
    })
    await client.copyFileSystemPath({
      sourcePath: '/repo/package.json',
      destinationPath: '/repo/package-copy.json',
    })
    await client.watchFileSystem('watch-1', '/repo/package.json')
    await client.unwatchFileSystem('watch-1')
    await client.listModels({ includeHidden: true })
    await client.readModelProviderCapabilities()
    await client.listExperimentalFeatures({ threadId: 'codex-thread-1' })
    await client.listPermissionProfiles({ cwd: '/repo' })
    await client.setExperimentalFeatureEnablement({
      features: { remoteControl: true },
    })
    await client.addEnvironment({
      environmentId: 'env-1',
      execServerUrl: 'https://exec.example',
    })
    await client.listCollaborationModes()
    await client.listSkills({ cwds: ['/repo'], forceReload: true })
    await client.setSkillExtraRoots(['/repo/.codex/skills'])
    await client.listHooks({ cwds: ['/repo'] })
    await client.addMarketplace({ marketplaceName: 'custom', source: 'owner/repo' })
    await client.removeMarketplace('custom')
    await client.upgradeMarketplace({ marketplaceName: 'custom' })
    await client.listPlugins({ includeDisabled: true })
    await client.listInstalledPlugins({ suggestions: ['foo'] })
    await client.readPlugin({ marketplacePath: '/market', pluginName: 'foo' })
    await client.readPluginSkill({
      remoteMarketplaceName: 'official',
      remotePluginId: 'foo',
      skillName: 'bar',
    })
    await client.listApps()
    await client.readAccount(true)
    await client.startAccountLogin({ type: 'chatgptDeviceCode' })
    await client.cancelAccountLogin('login-1')
    await client.logoutAccount()
    await client.readAccountRateLimits()
    await client.readAccountUsage({ rangeDays: 7 })
    await client.sendAddCreditsNudgeEmail('credits')
    await client.enableRemoteControl()
    await client.disableRemoteControl()
    await client.readRemoteControlStatus()
    await client.startRemoteControlPairing({ manualCode: true })
    await client.readRemoteControlPairingStatus({ pairingCode: 'pair-1' })
    await client.listRemoteControlClients({
      environmentId: 'env-1',
      order: 'desc',
    })
    await client.revokeRemoteControlClient({
      environmentId: 'env-1',
      clientId: 'client-1',
    })
    await client.writeSkillConfig({ skillName: 'foo', enabled: true })
    await client.installPlugin({ pluginId: 'foo@official' })
    await client.uninstallPlugin({ pluginId: 'foo@official' })
    await client.startMcpOauthLogin('fetch')
    await client.requestUserInput({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
    })
    await client.listMcpServerStatus({ detail: 'full' })
    await client.readMcpResource({ server: 'fetch', uri: 'resource://one' })
    await client.callMcpTool({
      threadId: 'codex-thread-1',
      server: 'fetch',
      tool: 'fetch',
      arguments: { url: 'https://example.com' },
    })
    await client.startWindowsSandboxSetup({ mode: 'unelevated', cwd: '/repo' })
    await client.uploadFeedback({ classification: 'bug', reason: 'broken' })
    await client.readConfig()
    await client.detectExternalAgentConfig({ includeHome: true, cwds: ['/repo'] })
    await client.importExternalAgentConfig({ migrationItems: [] })
    await client.writeConfigValue('desktop.theme', 'dark')
    await client.batchWriteConfig({
      edits: [{ keyPath: 'desktop.theme', value: 'light' }],
      reloadUserConfig: true,
    })
    await client.readConfigRequirements()
    await client.listThreads({ limit: 20, archived: false })
    await client.listLoadedThreads()
    await client.readThread('codex-thread-1', { includeTurns: true })
    await client.listThreadTurns('codex-thread-1', { limit: 5 })
    await client.listThreadTurnItems({
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
    })
    await client.forkThread('codex-thread-1', { ephemeral: true })
    await client.updateThreadMetadata('codex-thread-1', {
      gitInfo: { branch: 'main' },
    })
    await client.updateThreadSettings('codex-thread-1', {
      model: 'gpt-test',
    })
    await client.setThreadMemoryMode('codex-thread-1', 'enabled')
    await client.resetMemory()
    await client.setThreadGoal('codex-thread-1', {
      objective: 'ship codex clone',
    })
    await client.getThreadGoal('codex-thread-1')
    await client.clearThreadGoal('codex-thread-1')
    await client.archiveThread('codex-thread-1')
    await client.unsubscribeThread('codex-thread-1')
    await client.setThreadName('codex-thread-1', 'Codex clone')
    await client.unarchiveThread('codex-thread-1')
    await client.injectThreadItems('codex-thread-1', [
      { type: 'message', role: 'user', content: 'injected' },
    ])
    await client.cleanBackgroundTerminals('codex-thread-1')
    await client.startThreadRealtime('codex-thread-1', {
      outputModality: 'text',
    })
    await client.appendThreadRealtimeAudio('codex-thread-1', 'AAAA')
    await client.appendThreadRealtimeText('codex-thread-1', 'hello realtime')
    await client.stopThreadRealtime('codex-thread-1')
    await client.shutdownCodex()

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'thread_started',
          threadId: 'codex-thread-1',
        }),
        expect.objectContaining({ type: 'assistant_delta', delta: 'hello' }),
        expect.objectContaining({
          type: 'approval_request',
          request: expect.objectContaining({ id: 'approval-1' }),
        }),
        expect.objectContaining({
          type: 'fs_changed',
          watchId: 'watch-1',
          changedPaths: ['/repo/package.json'],
        }),
        expect.objectContaining({
          type: 'account_updated',
          authMode: 'chatgpt',
          planType: 'plus',
        }),
        expect.objectContaining({
          type: 'account_rate_limits_updated',
          rateLimits: { primary: { usedPercent: 25 } },
        }),
        expect.objectContaining({
          type: 'mcp_oauth_login_completed',
          name: 'fetch',
          success: true,
        }),
        expect.objectContaining({
          type: 'mcp_startup_status_updated',
          threadId: 'codex-thread-1',
          name: 'fetch',
          status: 'ready',
        }),
        expect.objectContaining({ type: 'turn_completed', turnId: 'turn-1' }),
      ])
    )
    expect(process.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'initialize' }),
        expect.objectContaining({ method: 'initialized' }),
        expect.objectContaining({ method: 'thread/start' }),
        expect.objectContaining({
          method: 'turn/start',
          params: expect.objectContaining({
            clientUserMessageId: 'user-message-1',
            input: [{ type: 'text', text: 'say hello', text_elements: [] }],
          }),
        }),
        { id: 'approval-1', result: { decision: 'approved' } },
        expect.objectContaining({ method: 'turn/interrupt' }),
        expect.objectContaining({
          method: 'thread/compact/start',
          params: { threadId: 'codex-thread-1' },
        }),
        expect.objectContaining({
          method: 'config/batchWrite',
          params: { edits: [], reloadUserConfig: true },
        }),
        expect.objectContaining({
          method: 'config/value/write',
          params: {
            keyPath: 'mcp_servers',
            value: {
              fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
            },
          },
        }),
        expect.objectContaining({ method: 'config/mcpServer/reload' }),
        expect.objectContaining({
          method: 'thread/shellCommand',
          params: {
            threadId: 'codex-thread-1',
            command: 'git status --short',
          },
        }),
        expect.objectContaining({
          method: 'thread/rollback',
          params: {
            threadId: 'codex-thread-1',
            numTurns: 2,
          },
        }),
        expect.objectContaining({
          method: 'review/start',
          params: {
            threadId: 'codex-thread-1',
            delivery: 'detached',
            target: {
              type: 'commit',
              sha: 'abc1234',
              title: 'Polish colors',
            },
            userFacingHint: 'review this commit',
          },
        }),
        expect.objectContaining({
          method: 'command/exec',
          params: {
            command: ['git', 'status', '--short'],
            processId: 'git-status-1',
            cwd: '/repo',
            tty: true,
            streamStdin: true,
            streamStdoutStderr: true,
          },
        }),
        expect.objectContaining({
          method: 'command/exec/write',
          params: {
            processId: 'git-status-1',
            deltaBase64: 'cHdkCg==',
          },
        }),
        expect.objectContaining({
          method: 'command/exec/resize',
          params: {
            processId: 'git-status-1',
            size: { rows: 48, cols: 120 },
          },
        }),
        expect.objectContaining({
          method: 'command/exec/terminate',
          params: { processId: 'git-status-1' },
        }),
        expect.objectContaining({
          method: 'process/spawn',
          params: {
            command: ['node', '-v'],
            processHandle: 'proc-1',
            cwd: '/repo',
            tty: true,
            streamStdin: true,
            streamStdoutStderr: true,
          },
        }),
        expect.objectContaining({
          method: 'process/writeStdin',
          params: { processHandle: 'proc-1', deltaBase64: 'Cg==' },
        }),
        expect.objectContaining({
          method: 'process/resizePty',
          params: { processHandle: 'proc-1', size: { rows: 24, cols: 80 } },
        }),
        expect.objectContaining({
          method: 'process/kill',
          params: { processHandle: 'proc-1' },
        }),
        expect.objectContaining({
          method: 'fs/readFile',
          params: { path: '/repo/package.json' },
        }),
        expect.objectContaining({
          method: 'fs/writeFile',
          params: { path: '/repo/package.json', dataBase64: 'e30=' },
        }),
        expect.objectContaining({
          method: 'fs/createDirectory',
          params: { path: '/repo/tmp/nested', recursive: true },
        }),
        expect.objectContaining({
          method: 'fs/getMetadata',
          params: { path: '/repo/package.json' },
        }),
        expect.objectContaining({
          method: 'fs/readDirectory',
          params: { path: '/repo' },
        }),
        expect.objectContaining({
          method: 'fs/remove',
          params: { path: '/repo/tmp', recursive: true, force: true },
        }),
        expect.objectContaining({
          method: 'fs/copy',
          params: {
            sourcePath: '/repo/package.json',
            destinationPath: '/repo/package-copy.json',
          },
        }),
        expect.objectContaining({
          method: 'fs/watch',
          params: { watchId: 'watch-1', path: '/repo/package.json' },
        }),
        expect.objectContaining({
          method: 'fs/unwatch',
          params: { watchId: 'watch-1' },
        }),
        expect.objectContaining({
          method: 'model/list',
          params: { includeHidden: true },
        }),
        expect.objectContaining({
          method: 'modelProvider/capabilities/read',
        }),
        expect.objectContaining({
          method: 'experimentalFeature/list',
          params: { threadId: 'codex-thread-1' },
        }),
        expect.objectContaining({
          method: 'permissionProfile/list',
          params: { cwd: '/repo' },
        }),
        expect.objectContaining({
          method: 'experimentalFeature/enablement/set',
          params: { features: { remoteControl: true } },
        }),
        expect.objectContaining({
          method: 'environment/add',
          params: {
            environmentId: 'env-1',
            execServerUrl: 'https://exec.example',
          },
        }),
        expect.objectContaining({ method: 'collaborationMode/list' }),
        expect.objectContaining({
          method: 'skills/list',
          params: { cwds: ['/repo'], forceReload: true },
        }),
        expect.objectContaining({
          method: 'skills/extraRoots/set',
          params: { roots: ['/repo/.codex/skills'] },
        }),
        expect.objectContaining({
          method: 'hooks/list',
          params: { cwds: ['/repo'] },
        }),
        expect.objectContaining({
          method: 'marketplace/add',
          params: { marketplaceName: 'custom', source: 'owner/repo' },
        }),
        expect.objectContaining({
          method: 'marketplace/remove',
          params: { marketplaceName: 'custom' },
        }),
        expect.objectContaining({
          method: 'marketplace/upgrade',
          params: { marketplaceName: 'custom' },
        }),
        expect.objectContaining({
          method: 'plugin/list',
          params: { includeDisabled: true },
        }),
        expect.objectContaining({
          method: 'plugin/installed',
          params: { suggestions: ['foo'] },
        }),
        expect.objectContaining({
          method: 'plugin/read',
          params: { marketplacePath: '/market', pluginName: 'foo' },
        }),
        expect.objectContaining({
          method: 'plugin/skill/read',
          params: {
            remoteMarketplaceName: 'official',
            remotePluginId: 'foo',
            skillName: 'bar',
          },
        }),
        expect.objectContaining({ method: 'app/list' }),
        expect.objectContaining({
          method: 'account/read',
          params: { refreshToken: true },
        }),
        expect.objectContaining({
          method: 'account/login/start',
          params: { type: 'chatgptDeviceCode' },
        }),
        expect.objectContaining({
          method: 'account/login/cancel',
          params: { loginId: 'login-1' },
        }),
        expect.objectContaining({ method: 'account/logout' }),
        expect.objectContaining({ method: 'account/rateLimits/read' }),
        expect.objectContaining({
          method: 'account/usage/read',
          params: { rangeDays: 7 },
        }),
        expect.objectContaining({
          method: 'account/sendAddCreditsNudgeEmail',
          params: { creditType: 'credits' },
        }),
        expect.objectContaining({ method: 'remoteControl/enable' }),
        expect.objectContaining({ method: 'remoteControl/disable' }),
        expect.objectContaining({ method: 'remoteControl/status/read' }),
        expect.objectContaining({
          method: 'remoteControl/pairing/start',
          params: { manualCode: true },
        }),
        expect.objectContaining({
          method: 'remoteControl/pairing/status',
          params: { pairingCode: 'pair-1' },
        }),
        expect.objectContaining({
          method: 'remoteControl/client/list',
          params: { environmentId: 'env-1', order: 'desc' },
        }),
        expect.objectContaining({
          method: 'remoteControl/client/revoke',
          params: { environmentId: 'env-1', clientId: 'client-1' },
        }),
        expect.objectContaining({
          method: 'skills/config/write',
          params: { skillName: 'foo', enabled: true },
        }),
        expect.objectContaining({
          method: 'plugin/install',
          params: { pluginId: 'foo@official' },
        }),
        expect.objectContaining({
          method: 'plugin/uninstall',
          params: { pluginId: 'foo@official' },
        }),
        expect.objectContaining({
          method: 'mcpServer/oauth/login',
          params: { server: 'fetch' },
        }),
        expect.objectContaining({
          method: 'tool/requestUserInput',
          params: { questions: [{ id: 'confirm', question: 'Proceed?' }] },
        }),
        expect.objectContaining({
          method: 'mcpServerStatus/list',
          params: { detail: 'full' },
        }),
        expect.objectContaining({
          method: 'mcpServer/resource/read',
          params: { server: 'fetch', uri: 'resource://one' },
        }),
        expect.objectContaining({
          method: 'mcpServer/tool/call',
          params: {
            threadId: 'codex-thread-1',
            server: 'fetch',
            tool: 'fetch',
            arguments: { url: 'https://example.com' },
          },
        }),
        expect.objectContaining({
          method: 'windowsSandbox/setupStart',
          params: { mode: 'unelevated', cwd: '/repo' },
        }),
        expect.objectContaining({
          method: 'feedback/upload',
          params: { classification: 'bug', reason: 'broken' },
        }),
        expect.objectContaining({ method: 'config/read' }),
        expect.objectContaining({
          method: 'externalAgentConfig/detect',
          params: { includeHome: true, cwds: ['/repo'] },
        }),
        expect.objectContaining({
          method: 'externalAgentConfig/import',
          params: { migrationItems: [] },
        }),
        expect.objectContaining({
          method: 'config/value/write',
          params: { keyPath: 'desktop.theme', value: 'dark' },
        }),
        expect.objectContaining({
          method: 'config/batchWrite',
          params: {
            edits: [{ keyPath: 'desktop.theme', value: 'light' }],
            reloadUserConfig: true,
          },
        }),
        expect.objectContaining({ method: 'configRequirements/read' }),
        expect.objectContaining({
          method: 'thread/list',
          params: { limit: 20, archived: false },
        }),
        expect.objectContaining({ method: 'thread/loaded/list' }),
        expect.objectContaining({
          method: 'thread/read',
          params: { threadId: 'codex-thread-1', includeTurns: true },
        }),
        expect.objectContaining({
          method: 'thread/turns/list',
          params: { threadId: 'codex-thread-1', limit: 5 },
        }),
        expect.objectContaining({
          method: 'thread/turns/items/list',
          params: { threadId: 'codex-thread-1', turnId: 'turn-1' },
        }),
        expect.objectContaining({
          method: 'thread/fork',
          params: { threadId: 'codex-thread-1', ephemeral: true },
        }),
        expect.objectContaining({
          method: 'thread/metadata/update',
          params: {
            threadId: 'codex-thread-1',
            gitInfo: { branch: 'main' },
          },
        }),
        expect.objectContaining({
          method: 'thread/settings/update',
          params: {
            threadId: 'codex-thread-1',
            settings: { model: 'gpt-test' },
          },
        }),
        expect.objectContaining({
          method: 'thread/memoryMode/set',
          params: { threadId: 'codex-thread-1', memoryMode: 'enabled' },
        }),
        expect.objectContaining({ method: 'memory/reset' }),
        expect.objectContaining({
          method: 'thread/goal/set',
          params: {
            threadId: 'codex-thread-1',
            goal: { objective: 'ship codex clone' },
          },
        }),
        expect.objectContaining({
          method: 'thread/goal/get',
          params: { threadId: 'codex-thread-1' },
        }),
        expect.objectContaining({
          method: 'thread/goal/clear',
          params: { threadId: 'codex-thread-1' },
        }),
        expect.objectContaining({
          method: 'thread/archive',
          params: { threadId: 'codex-thread-1' },
        }),
        expect.objectContaining({
          method: 'thread/unsubscribe',
          params: { threadId: 'codex-thread-1' },
        }),
        expect.objectContaining({
          method: 'thread/name/set',
          params: { threadId: 'codex-thread-1', name: 'Codex clone' },
        }),
        expect.objectContaining({
          method: 'thread/unarchive',
          params: { threadId: 'codex-thread-1' },
        }),
        expect.objectContaining({
          method: 'thread/inject_items',
          params: {
            threadId: 'codex-thread-1',
            items: [{ type: 'message', role: 'user', content: 'injected' }],
          },
        }),
        expect.objectContaining({
          method: 'thread/backgroundTerminals/clean',
          params: { threadId: 'codex-thread-1' },
        }),
        expect.objectContaining({
          method: 'thread/realtime/start',
          params: { threadId: 'codex-thread-1', outputModality: 'text' },
        }),
        expect.objectContaining({
          method: 'thread/realtime/appendAudio',
          params: { threadId: 'codex-thread-1', audioBase64: 'AAAA' },
        }),
        expect.objectContaining({
          method: 'thread/realtime/appendText',
          params: { threadId: 'codex-thread-1', text: 'hello realtime' },
        }),
        expect.objectContaining({
          method: 'thread/realtime/stop',
          params: { threadId: 'codex-thread-1' },
        }),
      ])
    )
  })
})
