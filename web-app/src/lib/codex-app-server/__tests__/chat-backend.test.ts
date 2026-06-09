import type { UIMessage } from '@ai-sdk/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  approveCodexAppServerAction,
  buildCodexSessionOptions,
  clearCodexAppServerChatSessionsForTests,
  sendCodexAppServerChatMessage,
} from '../chat-backend'

const mockApproval = vi.hoisted(() => ({
  showApprovalModal: vi.fn(),
}))

const mockAppState = vi.hoisted(() => ({
  updatePromptProgress: vi.fn(),
  updateLoadingModel: vi.fn(),
  updateThreadPromptProgress: vi.fn(),
  updateThreadLoadingModel: vi.fn(),
  setCurrentStreamThreadId: vi.fn(),
}))

const mockSessionState = vi.hoisted(() => ({
  instances: [] as Array<{
    sendToCodex: ReturnType<typeof vi.fn>
    approveAction: ReturnType<typeof vi.fn>
    interruptTurn: ReturnType<typeof vi.fn>
    shutdownCodex: ReturnType<typeof vi.fn>
  }>,
  constructorParams: [] as unknown[],
  approvalRequest: {
    id: 'approval-1',
    method: 'item/commandExecution/requestApproval',
    params: {
      command: 'npm test',
      cwd: '/repo',
      reason: 'Run test suite',
    },
  } as {
    id: string
    method: string
    params?: unknown
  },
}))

const mockThreadsState = vi.hoisted(() => ({
  threads: {
    'thread-1': { id: 'thread-1', title: 'Thread 1', metadata: {} },
  } as Record<string, { id: string; title?: string; metadata?: Record<string, unknown> }>,
}))

const mockWorkspaceState = vi.hoisted(() => ({
  directories: new Map<string, string>(),
  calls: [] as unknown[],
}))

vi.mock('@/hooks/useToolApproval', () => ({
  useToolApproval: { getState: () => mockApproval },
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () => ({
      ...mockAppState,
      currentStreamThreadId: 'thread-1',
    }),
  },
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: {
    getState: () => ({
      threads: mockThreadsState.threads,
    }),
  },
}))

vi.mock('@/stores/workspace-directory-store', () => ({
  useWorkspaceDirectories: {
    getState: () => ({
      getDirectory: (input: { type: string; id: string; label: string }) => {
        mockWorkspaceState.calls.push(input)
        return mockWorkspaceState.directories.get(`${input.type}:${input.id}`)
      },
    }),
  },
}))

vi.mock('../tauri-process', () => ({
  TauriCodexProcessSpawner: class {},
}))

vi.mock('../api', () => ({
  CodexAppServerClient: class {
    sendToCodex = vi.fn(async function* () {
      yield {
        type: 'approval_request',
        request: mockSessionState.approvalRequest,
      }
      yield {
        type: 'turn_completed',
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        turn: { id: 'turn-1', status: 'completed' },
      }
    })
    approveAction = vi.fn()
    interruptTurn = vi.fn()
    shutdownCodex = vi.fn()

    constructor(params: unknown) {
      mockSessionState.instances.push(this)
      mockSessionState.constructorParams.push(params)
    }
  },
}))

const provider: ModelProvider = {
  active: true,
  provider: 'codex',
  api_key: 'test-key',
  base_url: 'https://api.openai.com/v1',
  settings: [],
  models: [],
}

const model: Model = { id: 'gpt-5.1-codex-max' }

const messages: UIMessage[] = [
  {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text: 'run the tests' }],
  } as UIMessage,
]

const collect = async (stream: ReadableStream) => {
  const reader = stream.getReader()
  const chunks = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return chunks
}

describe('Codex chat backend approval bridge', () => {
  beforeEach(() => {
    clearCodexAppServerChatSessionsForTests()
    mockSessionState.instances.length = 0
    mockSessionState.constructorParams.length = 0
    mockSessionState.approvalRequest = {
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'npm test',
        cwd: '/repo',
        reason: 'Run test suite',
      },
    }
    mockThreadsState.threads = {
      'thread-1': { id: 'thread-1', title: 'Thread 1', metadata: {} },
    }
    mockWorkspaceState.directories.clear()
    mockWorkspaceState.calls.length = 0
    mockApproval.showApprovalModal.mockReset()
    mockApproval.showApprovalModal.mockResolvedValue(true)
    Object.values(mockAppState).forEach((fn) => fn.mockReset())
  })

  it('routes Codex approval requests through Jan approval modal and accepts approved actions', async () => {
    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messageId: 'assistant-1',
      messages,
      provider,
      model,
    })

    const chunks = await collect(stream)

    expect(mockApproval.showApprovalModal).toHaveBeenCalledWith(
      'Codex command',
      'thread-1',
      expect.objectContaining({
        command: 'npm test',
        cwd: '/repo',
        reason: 'Run test suite',
      })
    )
    expect(mockSessionState.instances[0].sendToCodex).toHaveBeenCalledWith(
      'thread-1',
      'run the tests',
      { clientUserMessageId: 'assistant-1' }
    )
    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'approval-1',
      { decision: 'approved' }
    )
    expect(chunks).toContainEqual({
      type: 'data-codex-event',
      data: expect.objectContaining({ type: 'approval_request' }),
    })
  })

  it('shows useful details for legacy command approval requests', async () => {
    mockSessionState.approvalRequest = {
      id: 'approval-legacy',
      method: 'execCommandApproval',
      params: {
        command: ['npm', 'test'],
        cwd: '/repo',
        reason: 'Run the test suite',
      },
    }

    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messageId: 'assistant-1',
      messages,
      provider,
      model,
    })

    await collect(stream)

    expect(mockApproval.showApprovalModal).toHaveBeenCalledWith(
      'Codex command',
      'thread-1',
      expect.objectContaining({
        command: 'npm test',
        cwd: '/repo',
        reason: 'Run the test suite',
      })
    )
    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'approval-legacy',
      { decision: 'approved' }
    )
  })

  it('can answer pending Codex approvals through the public backend API', async () => {
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    approveCodexAppServerAction('thread-1', 'approval-2', {
      approved: true,
      rememberForSession: true,
    })

    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'approval-2',
      { decision: 'approved_for_session' }
    )
  })

  it('builds isolated Codex options from project-bound workspace and provider settings', () => {
    mockThreadsState.threads = {
      'thread-1': {
        id: 'thread-1',
        title: 'Thread 1',
        metadata: {
          project: {
            id: 'project-1',
            name: 'Project One',
          },
        },
      },
    }
    mockWorkspaceState.directories.set('project:project-1', '/Users/conrad/project-one')

    const options = buildCodexSessionOptions(
      'thread-1',
      providerWithSettings({
        apiKey: 'settings-key',
        baseUrl: 'http://127.0.0.1:8000/v1',
        codexProvider: 'openrouter',
        codexBinaryPath: '/usr/local/bin/codex',
      }),
      { id: 'gpt-oss:20b' }
    )

    expect(options).toEqual(
      expect.objectContaining({
        codexBinaryPath: '/usr/local/bin/codex',
        codexHome: '/Users/conrad/project-one/.jan/codex-home',
        cwd: '/Users/conrad/project-one',
        model: 'gpt-oss:20b',
        modelProvider: 'openrouter',
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
        env: { JAN_CODEX_PROVIDER_API_KEY: 'settings-key' },
      })
    )
    expect(options.configToml).toContain('model = "gpt-oss:20b"')
    expect(options.configToml).toContain('model_provider = "openrouter"')
    expect(options.configToml).toContain('[model_providers.openrouter]')
    expect(options.configToml).toContain('base_url = "http://127.0.0.1:8000/v1"')
    expect(options.configToml).toContain('env_key = "JAN_CODEX_PROVIDER_API_KEY"')
    expect(options.configToml).toContain('wire_api = "responses"')
    expect(mockWorkspaceState.calls).toEqual([
      { type: 'project', id: 'project-1', label: 'Project One' },
    ])
  })

  it('uses chat-bound workspace directories and falls back to current directory', () => {
    mockWorkspaceState.directories.set('chat:thread-1', '/Users/conrad/chat-space/')

    expect(buildCodexSessionOptions('thread-1', provider, model)).toEqual(
      expect.objectContaining({
        cwd: '/Users/conrad/chat-space/',
        codexHome: '/Users/conrad/chat-space/.jan/codex-home',
      })
    )

    mockWorkspaceState.directories.clear()

    expect(buildCodexSessionOptions('thread-1', provider, model)).toEqual(
      expect.objectContaining({
        cwd: './',
        codexHome: './.jan/codex-home',
      })
    )
  })

  it('reuses sessions for stable runtime signatures and replaces them when config changes', async () => {
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    expect(mockSessionState.instances).toHaveLength(1)

    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider: providerWithSettings({ baseUrl: 'http://127.0.0.1:11434/v1' }),
      model,
    })

    expect(mockSessionState.instances).toHaveLength(2)
    expect(mockSessionState.instances[0].shutdownCodex).toHaveBeenCalled()
    expect(mockSessionState.constructorParams[1]).toEqual(
      expect.objectContaining({
        options: expect.objectContaining({
          configToml: expect.stringContaining('base_url = "http://127.0.0.1:11434/v1"'),
        }),
      })
    )
  })

  it('replaces sessions when provider env changes', async () => {
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider: providerWithSettings({
        apiKey: 'first-key',
        baseUrl: 'http://127.0.0.1:11434/v1',
      }),
      model,
    })
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider: providerWithSettings({
        apiKey: 'second-key',
        baseUrl: 'http://127.0.0.1:11434/v1',
      }),
      model,
    })

    expect(mockSessionState.instances).toHaveLength(2)
    expect(mockSessionState.instances[0].shutdownCodex).toHaveBeenCalled()
    expect(mockSessionState.constructorParams[1]).toEqual(
      expect.objectContaining({
        options: expect.objectContaining({
          env: { JAN_CODEX_PROVIDER_API_KEY: 'second-key' },
        }),
      })
    )
  })

  it('removes abort listeners after the Codex stream finishes', async () => {
    const abortController = new AbortController()
    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
      abortSignal: abortController.signal,
    })

    await collect(stream)
    abortController.abort()

    expect(mockSessionState.instances[0].interruptTurn).not.toHaveBeenCalled()
  })
})

function providerWithSettings({
  apiKey = '',
  baseUrl = '',
  codexProvider = '',
  codexBinaryPath = '',
}: {
  apiKey?: string
  baseUrl?: string
  codexProvider?: string
  codexBinaryPath?: string
}): ModelProvider {
  return {
    active: true,
    provider: 'codex',
    api_key: '',
    base_url: '',
    settings: [
      setting('api-key', apiKey),
      setting('base-url', baseUrl),
      setting('codex-provider', codexProvider),
      setting('codex-binary-path', codexBinaryPath),
    ],
    models: [],
  }
}

function setting(key: string, value: string) {
  return {
    key,
    controller_props: { value },
  } as ModelProvider['settings'][number]
}
