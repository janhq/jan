import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSetupChecklist } from '../useSetupChecklist'

const mockGetHardwareInfo = vi.fn()
const mockVerifyGpuOffload = vi.fn()
const mockVerifyEmbeddingModel = vi.fn()

const eventHandlers: Record<string, ((payload?: unknown) => void)[]> = {}
const emit = async (name: string, payload?: unknown) => {
  await act(async () => {
    ;(eventHandlers[name] ?? []).forEach((handler) => handler(payload))
  })
}

vi.mock('@janhq/core', () => ({
  AppEvent: { onModelImported: 'onModelImported' },
  DownloadEvent: { onFileDownloadSuccess: 'onFileDownloadSuccess' },
  events: {
    on: (name: string, handler: (payload?: unknown) => void) => {
      ;(eventHandlers[name] ??= []).push(handler)
    },
    off: (name: string, handler: (payload?: unknown) => void) => {
      eventHandlers[name] = (eventHandlers[name] ?? []).filter(
        (h) => h !== handler
      )
    },
  },
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    hardware: () => ({ getHardwareInfo: mockGetHardwareInfo }),
    models: () => ({
      verifyGpuOffload: mockVerifyGpuOffload,
      verifyEmbeddingModel: mockVerifyEmbeddingModel,
    }),
  }),
}))

const armHealthy = () => {
  mockGetHardwareInfo.mockResolvedValue({
    cpu: { name: 'Ryzen 7 5800X' },
    gpus: [{ name: 'NVIDIA RTX 4070', driver_version: '550.54' }],
  })
  mockVerifyGpuOffload.mockResolvedValue({
    status: 'ok',
    backend: 'linux-cuda-12-common_cpus-x64',
    gpuExpected: true,
    engineDeviceCount: 1,
  })
  mockVerifyEmbeddingModel.mockResolvedValue({
    status: 'ok',
    modelId: 'sentence-transformer-mini',
    dimension: 384,
  })
}

const stageById = (
  stages: ReturnType<typeof useSetupChecklist>['stages'],
  id: string
) => stages.find((s) => s.id === id)!

describe('useSetupChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(eventHandlers)) delete eventHandlers[key]
  })

  it('reports every stage ok on a healthy machine', async () => {
    armHealthy()

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    expect(result.current.stages.map((s) => s.status)).toEqual([
      'ok',
      'ok',
      'ok',
    ])
    expect(result.current.warnings).toHaveLength(0)
  })

  it('exposes the three stages in a stable order', async () => {
    armHealthy()

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    expect(result.current.stages.map((s) => s.id)).toEqual([
      'system',
      'engine',
      'search',
    ])
  })

  it('describes detected GPU hardware', async () => {
    armHealthy()

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    const system = stageById(result.current.stages, 'system')
    expect(system.messageKey).toBe('checkSystemGpu')
    expect(system.values).toMatchObject({
      gpus: 'NVIDIA RTX 4070',
      driver: '550.54',
    })
  })

  // On a hybrid laptop the integrated GPU usually sorts first, so listing only
  // the first entry reads as "no discrete GPU found".
  it('lists every detected GPU, not just the first', async () => {
    armHealthy()
    mockGetHardwareInfo.mockResolvedValue({
      cpu: { name: 'Core i9-13900H' },
      gpus: [
        { name: 'Intel Iris Xe Graphics', vendor: 'Intel', total_memory: 2048 },
        {
          name: 'NVIDIA RTX 4070',
          vendor: 'NVIDIA',
          total_memory: 8192,
          driver_version: '550.54',
        },
      ],
    })

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    const system = stageById(result.current.stages, 'system')
    expect(system.values?.gpus).toBe(
      'Intel Iris Xe Graphics (2 GB), NVIDIA RTX 4070 (8 GB)'
    )
    expect(system.status).toBe('ok')
  })

  it('omits the driver clause when no GPU reports one', async () => {
    armHealthy()
    mockGetHardwareInfo.mockResolvedValue({
      cpu: { name: 'Ryzen 7 5800X' },
      gpus: [{ name: 'AMD Radeon RX 7900 XTX', vendor: 'AMD' }],
    })
    mockVerifyGpuOffload.mockResolvedValue({
      status: 'ok',
      backend: 'linux-vulkan-common_cpus-x64',
      gpuExpected: true,
      engineDeviceCount: 1,
    })

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    expect(stageById(result.current.stages, 'system').messageKey).toBe(
      'checkSystemGpuNoDriver'
    )
  })

  // The engine reports a healthy "running on CPU" here; only the cross-check
  // against detected hardware can tell that the GPU is being wasted.
  it('warns when a GPU is present but a CPU-only backend is installed', async () => {
    armHealthy()
    mockVerifyGpuOffload.mockResolvedValue({
      status: 'ok',
      backend: 'linux-common_cpus-x64',
      gpuExpected: false,
      engineDeviceCount: 0,
    })

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    const engine = stageById(result.current.stages, 'engine')
    expect(engine.status).toBe('warning')
    expect(engine.messageKey).toBe('checkEngineGpuUnused')
    expect(engine.values).toMatchObject({
      backend: 'linux-common_cpus-x64',
      gpus: 'NVIDIA RTX 4070',
    })
  })

  it('stays ok for a CPU backend on a machine with no GPU', async () => {
    armHealthy()
    mockGetHardwareInfo.mockResolvedValue({
      cpu: { name: 'Ryzen 7 5800X' },
      gpus: [],
    })
    mockVerifyGpuOffload.mockResolvedValue({
      status: 'ok',
      backend: 'linux-common_cpus-x64',
      gpuExpected: false,
      engineDeviceCount: 0,
    })

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    const engine = stageById(result.current.stages, 'engine')
    expect(engine.status).toBe('ok')
    expect(engine.messageKey).toBe('checkEngineCpu')
  })

  it('warns when the installed GPU build is for the wrong vendor', async () => {
    armHealthy()
    mockGetHardwareInfo.mockResolvedValue({
      cpu: { name: 'Ryzen 7 5800X' },
      gpus: [
        {
          name: 'AMD Radeon RX 7900 XTX',
          vendor: 'AMD',
          total_memory: 24576,
          driver_version: '24.1',
        },
      ],
    })
    mockVerifyGpuOffload.mockResolvedValue({
      status: 'ok',
      backend: 'linux-cuda-12-common_cpus-x64',
      gpuExpected: true,
      engineDeviceCount: 1,
    })

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    const engine = stageById(result.current.stages, 'engine')
    expect(engine.status).toBe('warning')
    expect(engine.messageKey).toBe('checkEngineVendorMismatch')
    expect(engine.values).toMatchObject({
      vendor: 'NVIDIA',
      gpus: 'AMD Radeon RX 7900 XTX (24 GB)',
    })
  })

  // Hardware detection failing must not turn a working engine into a warning.
  it('trusts the engine when hardware detection reports nothing', async () => {
    armHealthy()
    mockGetHardwareInfo.mockResolvedValue(null)

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    expect(stageById(result.current.stages, 'engine').status).toBe('ok')
  })

  it('describes a CPU-only machine without claiming a GPU', async () => {
    armHealthy()
    mockGetHardwareInfo.mockResolvedValue({
      cpu: { name: 'Ryzen 7 5800X' },
      gpus: [],
    })

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    const system = stageById(result.current.stages, 'system')
    expect(system.messageKey).toBe('checkSystemCpuOnly')
    expect(system.status).toBe('ok')
  })

  // The silent CPU-fallback case must reach the user as a warning.
  it('surfaces a GPU backend that cannot reach its GPU', async () => {
    armHealthy()
    mockVerifyGpuOffload.mockResolvedValue({
      status: 'warning',
      backend: 'linux-cuda-12-common_cpus-x64',
      gpuExpected: true,
      engineDeviceCount: 0,
      reason: 'runtimeUnreachable',
    })

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    const engine = stageById(result.current.stages, 'engine')
    expect(engine.status).toBe('warning')
    expect(engine.messageKey).toBe('checkEngineRuntimeUnreachable')
    expect(result.current.warnings).toHaveLength(1)
  })

  it('distinguishes a machine with no GPU from an unreachable one', async () => {
    armHealthy()
    mockVerifyGpuOffload.mockResolvedValue({
      status: 'warning',
      backend: 'linux-cuda-12-common_cpus-x64',
      gpuExpected: true,
      engineDeviceCount: 0,
      reason: 'noGpuHardware',
    })

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    expect(stageById(result.current.stages, 'engine').messageKey).toBe(
      'checkEngineNoGpuHardware'
    )
  })

  // The cause is established, so the message names the dependency rather than
  // guessing at the driver.
  it('reports a named missing library instead of a generic GPU warning', async () => {
    armHealthy()
    mockVerifyGpuOffload.mockResolvedValue({
      status: 'warning',
      backend: 'linux-cuda-12-common_cpus-x64',
      gpuExpected: true,
      engineDeviceCount: 0,
      reason: 'missingLibrary',
      missingLibraries: ['libnccl.so.2', 'libcublas.so.12'],
    })

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    const engine = stageById(result.current.stages, 'engine')
    expect(engine.status).toBe('warning')
    expect(engine.messageKey).toBe('checkEngineMissingLibrary')
    expect(engine.values).toMatchObject({
      backend: 'linux-cuda-12-common_cpus-x64',
      libraries: 'libnccl.so.2, libcublas.so.12',
    })
  })

  it('maps each embedding vector problem to its own message', async () => {
    const cases = {
      missing: 'checkSearchNoVector',
      empty: 'checkSearchNoVector',
      nonFinite: 'checkSearchInvalidVector',
      degenerate: 'checkSearchInvalidVector',
    } as const

    for (const [problem, expected] of Object.entries(cases)) {
      armHealthy()
      mockVerifyEmbeddingModel.mockResolvedValue({
        status: 'warning',
        modelId: 'sentence-transformer-mini',
        dimension: 384,
        problem,
      })

      const { result } = renderHook(() => useSetupChecklist())

      await waitFor(() => expect(result.current.isRunning).toBe(false))
      expect(stageById(result.current.stages, 'search').messageKey, problem).toBe(
        expected
      )
    }
  })

  it('reports the embedding model and dimension when healthy', async () => {
    armHealthy()

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    expect(stageById(result.current.stages, 'search').values).toMatchObject({
      model: 'sentence-transformer-mini',
      dimension: 384,
    })
  })

  // One failing probe must not hide the verdicts of the others.
  it('keeps other stages meaningful when one check rejects', async () => {
    armHealthy()
    mockVerifyEmbeddingModel.mockRejectedValue(new Error('router down'))

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    expect(stageById(result.current.stages, 'system').status).toBe('ok')
    expect(stageById(result.current.stages, 'engine').status).toBe('ok')
    const search = stageById(result.current.stages, 'search')
    expect(search.status).toBe('warning')
    expect(search.detail).toContain('router down')
  })

  it('warns when hardware detection fails', async () => {
    armHealthy()
    mockGetHardwareInfo.mockRejectedValue(new Error('plugin missing'))

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    const system = stageById(result.current.stages, 'system')
    expect(system.status).toBe('warning')
    expect(system.messageKey).toBe('checkSystemFailed')
  })

  it('reports an engine build that cannot run the check', async () => {
    armHealthy()
    mockVerifyGpuOffload.mockResolvedValue({
      status: 'warning',
      backend: '',
      gpuExpected: false,
      engineDeviceCount: 0,
      unavailable: true,
    })

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    expect(stageById(result.current.stages, 'engine').messageKey).toBe(
      'checkEngineUnavailable'
    )
  })

  it('does not run the probes when disabled', async () => {
    armHealthy()

    const { result } = renderHook(() => useSetupChecklist({ enabled: false }))

    expect(result.current.stages.every((s) => s.status === 'pending')).toBe(true)
    expect(mockVerifyEmbeddingModel).not.toHaveBeenCalled()
    expect(mockGetHardwareInfo).not.toHaveBeenCalled()
  })

  it('runs each probe once for a single mount', async () => {
    armHealthy()

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    expect(mockVerifyGpuOffload).toHaveBeenCalledTimes(1)
    expect(mockVerifyEmbeddingModel).toHaveBeenCalledTimes(1)
  })

  // A fresh install downloads a backend before it has one, so the engine row
  // must not accuse a not-yet-chosen backend of being CPU-only.
  it('shows the engine as still preparing while no backend is selected', async () => {
    armHealthy()
    mockVerifyGpuOffload.mockResolvedValue({
      status: 'ok',
      backend: '',
      gpuExpected: false,
      engineDeviceCount: 0,
    })

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    const engine = stageById(result.current.stages, 'engine')
    expect(engine.status).toBe('running')
    expect(engine.messageKey).toBe('checkEnginePreparing')
    expect(result.current.warnings).toHaveLength(0)
  })

  // The engine reports this itself while it downloads a backend; the search
  // check cannot run before the router it depends on exists.
  it('shows both engine and search as pending while the engine sets itself up', async () => {
    armHealthy()
    mockVerifyGpuOffload.mockResolvedValue({
      status: 'ok',
      backend: '',
      gpuExpected: false,
      engineDeviceCount: 0,
      pending: true,
    })
    mockVerifyEmbeddingModel.mockResolvedValue({ status: 'ok', pending: true })

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    expect(stageById(result.current.stages, 'engine').status).toBe('running')
    expect(stageById(result.current.stages, 'engine').messageKey).toBe(
      'checkEnginePreparing'
    )
    expect(stageById(result.current.stages, 'search').status).toBe('running')
    expect(stageById(result.current.stages, 'search').messageKey).toBe(
      'checkSearchPreparing'
    )
    expect(result.current.warnings).toHaveLength(0)
  })

  // `unavailable` means the build cannot ever run the check, so it outranks a
  // transient pending state.
  it('prefers an unavailable verdict over a pending one', async () => {
    armHealthy()
    mockVerifyGpuOffload.mockResolvedValue({
      status: 'warning',
      backend: '',
      gpuExpected: false,
      engineDeviceCount: 0,
      unavailable: true,
      pending: true,
    })

    const { result } = renderHook(() => useSetupChecklist())

    await waitFor(() => expect(result.current.isRunning).toBe(false))
    expect(stageById(result.current.stages, 'engine').messageKey).toBe(
      'checkEngineUnavailable'
    )
  })

  describe('following the engine background setup', () => {
    it('re-checks when the engine picks a backend', async () => {
      armHealthy()
      const { result } = renderHook(() => useSetupChecklist())
      await waitFor(() => expect(result.current.isRunning).toBe(false))

      await emit('settingsChanged', { key: 'llamacpp_backend' })

      await waitFor(() =>
        expect(mockVerifyGpuOffload).toHaveBeenCalledTimes(2)
      )
    })

    it('ignores unrelated setting changes', async () => {
      armHealthy()
      const { result } = renderHook(() => useSetupChecklist())
      await waitFor(() => expect(result.current.isRunning).toBe(false))

      await emit('settingsChanged', { key: 'some_other_setting' })
      await emit('settingsChanged', undefined)

      expect(mockVerifyGpuOffload).toHaveBeenCalledTimes(1)
    })

    it('re-checks when the engine binary finishes downloading', async () => {
      armHealthy()
      const { result } = renderHook(() => useSetupChecklist())
      await waitFor(() => expect(result.current.isRunning).toBe(false))

      await emit('onFileDownloadSuccess', { downloadType: 'Engine' })

      await waitFor(() =>
        expect(mockVerifyGpuOffload).toHaveBeenCalledTimes(2)
      )
    })

    it('ignores a model download finishing', async () => {
      armHealthy()
      const { result } = renderHook(() => useSetupChecklist())
      await waitFor(() => expect(result.current.isRunning).toBe(false))

      await emit('onFileDownloadSuccess', { downloadType: 'Model' })

      expect(mockVerifyGpuOffload).toHaveBeenCalledTimes(1)
    })

    it('re-checks when the embedding model is imported', async () => {
      armHealthy()
      const { result } = renderHook(() => useSetupChecklist())
      await waitFor(() => expect(result.current.isRunning).toBe(false))

      await emit('onModelImported', { embedding: true })

      await waitFor(() =>
        expect(mockVerifyEmbeddingModel).toHaveBeenCalledTimes(2)
      )
    })

    it('ignores a chat model being imported', async () => {
      armHealthy()
      const { result } = renderHook(() => useSetupChecklist())
      await waitFor(() => expect(result.current.isRunning).toBe(false))

      await emit('onModelImported', { modelId: 'jan-v3', embedding: false })

      expect(mockVerifyEmbeddingModel).toHaveBeenCalledTimes(1)
    })

    it('stops listening once unmounted', async () => {
      armHealthy()
      const { result, unmount } = renderHook(() => useSetupChecklist())
      await waitFor(() => expect(result.current.isRunning).toBe(false))

      unmount()
      await emit('onFileDownloadSuccess', { downloadType: 'Engine' })

      expect(mockVerifyGpuOffload).toHaveBeenCalledTimes(1)
    })

    // Dropping it would strand the checklist on the verdict of the run that was
    // already in flight when the newer state landed.
    it('queues a request that arrives mid-run instead of dropping it', async () => {
      armHealthy()
      let release: (() => void) | undefined
      mockVerifyGpuOffload.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                status: 'ok',
                backend: 'linux-cuda-12-common_cpus-x64',
                gpuExpected: true,
                engineDeviceCount: 1,
              })
          })
      )

      const { result } = renderHook(() => useSetupChecklist())
      await waitFor(() => expect(mockVerifyGpuOffload).toHaveBeenCalledTimes(1))

      await emit('onFileDownloadSuccess', { downloadType: 'Engine' })
      expect(mockVerifyGpuOffload).toHaveBeenCalledTimes(1)

      await act(async () => {
        release?.()
      })

      await waitFor(() => expect(mockVerifyGpuOffload).toHaveBeenCalledTimes(2))
      await act(async () => {
        release?.()
      })
      await waitFor(() => expect(result.current.isRunning).toBe(false))
    })
  })

  describe('gpu verdict', () => {
    it('confirms GPU use and names the hardware', async () => {
      armHealthy()

      const { result } = renderHook(() => useSetupChecklist())

      await waitFor(() => expect(result.current.isRunning).toBe(false))
      expect(result.current.gpu).toEqual({
        willUse: true,
        label: 'NVIDIA RTX 4070',
      })
    })

    // A GPU build that found no device runs on the CPU regardless of its name.
    it('reports CPU when a GPU build sees no device', async () => {
      armHealthy()
      mockVerifyGpuOffload.mockResolvedValue({
        status: 'warning',
        backend: 'linux-cuda-12-common_cpus-x64',
        gpuExpected: true,
        engineDeviceCount: 0,
        reason: 'runtimeUnreachable',
      })

      const { result } = renderHook(() => useSetupChecklist())

      await waitFor(() => expect(result.current.isRunning).toBe(false))
      expect(result.current.gpu.willUse).toBe(false)
      // The hardware is still named, so the badge can say what is going unused.
      expect(result.current.gpu.label).toBe('NVIDIA RTX 4070')
    })

    it('reports CPU for a CPU-only build', async () => {
      armHealthy()
      mockGetHardwareInfo.mockResolvedValue({
        cpu: { name: 'Ryzen 7 5800X' },
        gpus: [],
      })
      mockVerifyGpuOffload.mockResolvedValue({
        status: 'ok',
        backend: 'linux-common_cpus-x64',
        gpuExpected: false,
        engineDeviceCount: 0,
      })

      const { result } = renderHook(() => useSetupChecklist())

      await waitFor(() => expect(result.current.isRunning).toBe(false))
      expect(result.current.gpu).toEqual({ willUse: false, label: '' })
    })

    // Neither answer is known until the engine has a backend.
    it('stays undecided while the engine is still setting up', async () => {
      armHealthy()
      mockVerifyGpuOffload.mockResolvedValue({
        status: 'ok',
        backend: '',
        gpuExpected: false,
        engineDeviceCount: 0,
        pending: true,
      })

      const { result } = renderHook(() => useSetupChecklist())

      await waitFor(() => expect(result.current.isRunning).toBe(false))
      expect(result.current.gpu.willUse).toBeUndefined()
      expect(result.current.gpu.label).toBe('NVIDIA RTX 4070')
    })

    // Metal is implicit on Apple Silicon: the engine never calls a macOS build a
    // GPU build and never enumerates Metal as a device. Reading those absences
    // literally told Apple Silicon users they were on CPU.
    it('reports GPU use for a macOS build despite no device count', async () => {
      armHealthy()
      mockGetHardwareInfo.mockResolvedValue({
        cpu: { name: 'Apple M3 Max' },
        gpus: [],
      })
      mockVerifyGpuOffload.mockResolvedValue({
        status: 'ok',
        backend: 'macos-arm64',
        gpuExpected: false,
        engineDeviceCount: 0,
      })

      const { result } = renderHook(() => useSetupChecklist())

      await waitFor(() => expect(result.current.isRunning).toBe(false))
      expect(result.current.gpu.willUse).toBe(true)
    })

    it('still defers to pending on macOS before a backend is chosen', async () => {
      armHealthy()
      mockVerifyGpuOffload.mockResolvedValue({
        status: 'ok',
        backend: '',
        gpuExpected: false,
        engineDeviceCount: 0,
        pending: true,
      })

      const { result } = renderHook(() => useSetupChecklist())

      await waitFor(() => expect(result.current.isRunning).toBe(false))
      expect(result.current.gpu.willUse).toBeUndefined()
    })

    it('stays undecided when the engine cannot report at all', async () => {
      armHealthy()
      mockVerifyGpuOffload.mockResolvedValue({
        status: 'warning',
        backend: '',
        gpuExpected: false,
        engineDeviceCount: 0,
        unavailable: true,
      })

      const { result } = renderHook(() => useSetupChecklist())

      await waitFor(() => expect(result.current.isRunning).toBe(false))
      expect(result.current.gpu.willUse).toBeUndefined()
    })

    it('stays undecided when the probe rejects', async () => {
      armHealthy()
      mockVerifyGpuOffload.mockRejectedValue(new Error('router down'))

      const { result } = renderHook(() => useSetupChecklist())

      await waitFor(() => expect(result.current.isRunning).toBe(false))
      expect(result.current.gpu.willUse).toBeUndefined()
    })
  })

  it('re-runs the probes on demand', async () => {
    armHealthy()

    const { result } = renderHook(() => useSetupChecklist())
    await waitFor(() => expect(result.current.isRunning).toBe(false))

    await act(async () => {
      await result.current.rerun()
    })

    expect(mockVerifyGpuOffload).toHaveBeenCalledTimes(2)
  })
})
