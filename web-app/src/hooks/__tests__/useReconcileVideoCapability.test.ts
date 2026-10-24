import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { ServiceKeys, createServiceRegistry, type ServiceRegistry } from '@janhq/core'

const h = vi.hoisted(() => ({
  services: undefined as unknown as ServiceRegistry,
  updateProvider: vi.fn(),
  provider: undefined as unknown,
}))
vi.mock('@/lib/extensions/host', () => ({
  getExtensionHost: () => ({ services: h.services }),
}))
vi.mock('../useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      getProviderByName: () => h.provider,
      updateProvider: h.updateProvider,
    }),
  },
}))

import { useReconcileVideoCapability } from '../useReconcileVideoCapability'

const provide = (video: boolean) => {
  const getModelProps = vi.fn().mockResolvedValue({
    nCtx: 1,
    modalities: { vision: true, video, audio: false },
  })
  h.services.provide(ServiceKeys.Llamacpp, {
    getModelProps,
    unload: vi.fn(),
    getDevices: vi.fn(),
    reconcileEngineDevices: vi.fn(),
  })
  return getModelProps
}

describe('useReconcileVideoCapability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.services = createServiceRegistry()
    h.provider = {
      provider: 'llamacpp',
      models: [{ id: 'm', capabilities: ['vision'] }],
    }
  })

  it('adds video when the llamacpp service reports it for the loaded model', async () => {
    const getModelProps = provide(true)
    renderHook(() => useReconcileVideoCapability('m', 'llamacpp'))
    await waitFor(() => expect(h.updateProvider).toHaveBeenCalled())
    expect(getModelProps).toHaveBeenCalledWith('m')
    expect(h.updateProvider.mock.calls[0][1].models[0].capabilities).toEqual([
      'vision',
      'video',
    ])
  })

  it('leaves a correct model alone', async () => {
    const getModelProps = provide(false)
    renderHook(() => useReconcileVideoCapability('m', 'llamacpp'))
    await waitFor(() => expect(getModelProps).toHaveBeenCalled())
    expect(h.updateProvider).not.toHaveBeenCalled()
  })

  it('does nothing for other providers or without the service', () => {
    const getModelProps = provide(true)
    renderHook(() => useReconcileVideoCapability('m', 'mlx'))
    expect(getModelProps).not.toHaveBeenCalled()
    h.services = createServiceRegistry()
    expect(() =>
      renderHook(() => useReconcileVideoCapability('m', 'llamacpp'))
    ).not.toThrow()
  })
})
