import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ServiceKeys, createServiceRegistry } from '@janhq/core'

const h = vi.hoisted(() => ({ services: undefined as unknown }))
vi.mock('@/lib/extensions/host', () => ({
  getExtensionHost: () => ({ services: h.services }),
}))

import {
  getLlamacppExtension,
  getLocalPropsExtension,
  getMlxExtension,
} from '../llamacppRouterProps'

const engine = () => ({
  getModelProps: vi.fn().mockResolvedValue({ nCtx: 1 }),
  unload: vi.fn().mockResolvedValue({ success: true }),
})

describe('local engine lookups', () => {
  beforeEach(() => {
    h.services = createServiceRegistry()
  })

  it('finds the llamacpp and mlx services in the host registry', () => {
    const registry = createServiceRegistry()
    h.services = registry
    const llama = { ...engine(), getDevices: vi.fn(), reconcileEngineDevices: vi.fn() }
    const mlx = engine()
    registry.provide(ServiceKeys.Llamacpp, llama)
    registry.provide(ServiceKeys.Mlx, mlx)
    expect(getLlamacppExtension()).toBe(llama)
    expect(getMlxExtension()).toBe(mlx)
    expect(getLocalPropsExtension('llamacpp')).toBe(llama)
    expect(getLocalPropsExtension('mlx')).toBe(mlx)
  })

  it('has nothing for an engine that is not running or a remote provider', () => {
    expect(getLlamacppExtension()).toBeUndefined()
    expect(getLocalPropsExtension('mlx')).toBeUndefined()
    expect(getLocalPropsExtension('openai')).toBeUndefined()
    expect(getLocalPropsExtension(undefined)).toBeUndefined()
  })
})
