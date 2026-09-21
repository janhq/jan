import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineManager } from '@janhq/core'
import type { AIEngine } from '@janhq/core'
import { DefaultModelsService } from '@/services/models/default'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useCoworkRun } from '@/hooks/useCoworkRun'
import {
  coworkModelContext,
  increaseCoworkContext,
  nextCoworkContextSize,
  recoverCoworkContext,
} from '@/lib/coworkModelControls'

vi.mock('@/lib/backendStorage', () => ({
  backendStorage: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}))

const models = new DefaultModelsService()

function providerFixture(name = 'llamacpp'): ModelProvider {
  return {
    provider: name,
    active: true,
    settings:
      name === 'llamacpp'
        ? [
            {
              key: 'fit',
              title: 'Fit',
              description: '',
              controller_type: 'checkbox',
              controller_props: { value: false },
            },
          ]
        : [],
    models: [
      {
        id: 'local-model',
        settings: {
          ctx_len: {
            key: 'ctx_len',
            title: 'Context',
            description: '',
            controller_type: 'input',
            controller_props: { value: 4096, max: 10000 },
          },
        },
      },
    ],
  }
}

function selectProvider(provider: ModelProvider) {
  useModelProvider.setState({
    providers: [provider],
    selectedProvider: provider.provider,
    selectedModel: provider.models[0],
  })
}

function currentContext() {
  return useModelProvider.getState().getProviderByName('llamacpp')?.models[0]
    .settings?.ctx_len.controller_props.value
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.spyOn(models, 'updateModelSettings').mockResolvedValue(undefined)
  vi.spyOn(models, 'getModelContextLimit').mockResolvedValue(undefined)
  vi.spyOn(models, 'getActiveModels').mockResolvedValue(['local-model'])
  vi.spyOn(models, 'stopModel').mockResolvedValue({ success: true })
  selectProvider(providerFixture())
  useCoworkSessions.setState({ sessions: [], currentId: null })
  useCoworkRun.setState({ runId: {} })
})

describe('Cowork context recovery settings', () => {
  it('uses Chat steps without exceeding the supported maximum', () => {
    expect(nextCoworkContextSize(4096, 10000)).toBe(8192)
    expect(nextCoworkContextSize(8192, 10000)).toBe(10000)
    expect(nextCoworkContextSize(10000, 10000)).toBeUndefined()
    expect(nextCoworkContextSize(32768, 131072)).toBe(49152)
  })

  it('reads missing context metadata only when recovering an overflow', async () => {
    const provider = providerFixture()
    delete provider.models[0].settings!.ctx_len.controller_props.max
    selectProvider(provider)
    vi.mocked(models.getModelContextLimit).mockResolvedValue(6000)
    await increaseCoworkContext(models, 'llamacpp', 'local-model')
    expect(currentContext()).toBe(6000)
  })

  it.each(['remote', 'inactive', 'missing context', 'unknown maximum'])(
    'does not invent a context action for %s models',
    async (kind) => {
      const provider = providerFixture(kind === 'remote' ? 'openai' : 'mlx')
      if (kind === 'inactive') provider.active = false
      if (kind === 'missing context') provider.models[0].settings = {}
      if (kind === 'unknown maximum')
        delete provider.models[0].settings!.ctx_len.controller_props.max
      selectProvider(provider)
      expect(coworkModelContext(provider, 'local-model')).toBeUndefined()
      await expect(
        increaseCoworkContext(models, provider.provider, 'local-model')
      ).rejects.toThrow('No supported context increase')
    }
  )

  it('publishes context only after application succeeds', async () => {
    const applying = Promise.withResolvers<void>()
    vi.mocked(models.updateModelSettings).mockReturnValueOnce(applying.promise)
    const increase = increaseCoworkContext(models, 'llamacpp', 'local-model')
    expect(currentContext()).toBe(4096)
    applying.resolve()
    await increase
    expect(currentContext()).toBe(8192)
  })

  it('keeps a newer selection when an earlier context save fails', async () => {
    const applying = Promise.withResolvers<void>()
    vi.mocked(models.updateModelSettings).mockReturnValueOnce(applying.promise)
    const increase = increaseCoworkContext(models, 'llamacpp', 'local-model')
    useModelProvider.setState({
      selectedProvider: 'openai',
      selectedModel: { id: 'remote' },
    })
    applying.reject(new Error('engine unavailable'))
    await expect(increase).rejects.toThrow('engine unavailable')
    expect(useModelProvider.getState().selectedProvider).toBe('openai')
    expect(useModelProvider.getState().selectedModel?.id).toBe('remote')
    expect(currentContext()).toBe(4096)
  })

  it('preserves context when MLX cannot unload its active model', async () => {
    selectProvider(providerFixture('mlx'))
    vi.mocked(models.stopModel).mockResolvedValueOnce({
      success: false,
      error: 'busy',
    })
    await expect(
      increaseCoworkContext(models, 'mlx', 'local-model')
    ).rejects.toThrow('busy')
    expect(
      useModelProvider.getState().selectedModel?.settings?.ctx_len
        .controller_props.value
    ).toBe(4096)
  })

  it('makes the next actual MLX load consume the increased context', async () => {
    selectProvider(providerFixture('mlx'))
    vi.mocked(models.getActiveModels).mockRestore()
    vi.mocked(models.stopModel).mockRestore()
    let loaded = true
    let loadedContext = 4096
    const mlx = {
      getLoadedModels: async () => (loaded ? ['local-model'] : []),
      unload: async () => {
        loaded = false
        return { success: true }
      },
      load: async (_id: string, settings: { ctx_size: number }) => {
        loaded = true
        loadedContext = settings.ctx_size
      },
    } as unknown as AIEngine
    const llama = {
      unload: async () => ({ success: true }),
    } as unknown as AIEngine
    const manager = new EngineManager()
    manager.engines.set('mlx', mlx)
    manager.engines.set('llamacpp', llama)
    vi.spyOn(EngineManager, 'instance').mockReturnValue(manager)
    await increaseCoworkContext(models, 'mlx', 'local-model')
    await models.startModel(
      useModelProvider.getState().providers[0],
      'local-model'
    )
    expect(loadedContext).toBe(8192)
  })
})

describe('Cowork context overflow recovery', () => {
  function completedToolSession() {
    const state = useCoworkSessions.getState()
    const id = state.createSession()
    state.commitTurns(
      id,
      [
        { role: 'user', content: 'write a file' },
        {
          role: 'tool',
          content: '',
          name: 'write_file',
          result: 'written',
          status: 'done',
        },
      ],
      [
        {
          id: 'question',
          role: 'user',
          parts: [{ type: 'text', text: 'write a file' }],
        },
        {
          id: 'completed-tool',
          role: 'assistant',
          parts: [{ type: 'text', text: 'file written' }],
        },
      ],
      []
    )
    return id
  }

  it('resumes committed tool history instead of replaying the question', async () => {
    const id = completedToolSession()
    let resumedIds: string[] = []
    await recoverCoworkContext(models, () => {
      resumedIds = useCoworkSessions
        .getState()
        .sessions.find((s) => s.id === id)!
        .messages.map((m) => m.id)
    })
    expect(resumedIds).toEqual(['question', 'completed-tool'])
    expect(currentContext()).toBe(8192)
  })

  it.each(['session', 'model', 'history', 'running'])(
    'does not retry after the originating %s changes during application',
    async (change) => {
      const id = completedToolSession()
      const applying = Promise.withResolvers<void>()
      vi.mocked(models.updateModelSettings).mockReturnValueOnce(
        applying.promise
      )
      const retry = vi.fn()
      const recovery = recoverCoworkContext(models, retry)
      if (change === 'session') useCoworkSessions.getState().createSession()
      if (change === 'model')
        useModelProvider.setState({
          selectedProvider: 'openai',
          selectedModel: { id: 'remote' },
        })
      if (change === 'history') useCoworkSessions.getState().clearSession(id)
      if (change === 'running')
        useCoworkRun.setState({ runId: { [id]: 'new-run' } })
      applying.resolve()
      await recovery
      expect(retry).not.toHaveBeenCalled()
    }
  )
})

