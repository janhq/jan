import { describe, expect, it } from 'vitest'
import {
  isLocalEngineId,
  isManagedCpuEngine,
  LOCAL_ENGINE_IDS,
  LOCAL_API_SERVER_ENGINES,
  MANAGED_CPU_ENGINES,
} from '../localProviders'

describe('localProviders', () => {
  it('treats the on-device engines as local', () => {
    expect(isLocalEngineId('llamacpp')).toBe(true)
    expect(isLocalEngineId('mlx')).toBe(true)
    expect(isLocalEngineId('litert-lm')).toBe(true)
  })

  it('does not treat cloud providers as local', () => {
    expect(isLocalEngineId('openai')).toBe(false)
    expect(isLocalEngineId('anthropic')).toBe(false)
    expect(isLocalEngineId('gemini')).toBe(false)
  })

  it('rejects empty input', () => {
    expect(isLocalEngineId(undefined)).toBe(false)
    expect(isLocalEngineId(null)).toBe(false)
    expect(isLocalEngineId('')).toBe(false)
  })

  it('reads the provider id off a provider object', () => {
    expect(isLocalEngineId({ provider: 'mlx' })).toBe(true)
    expect(isLocalEngineId({ provider: 'openai' })).toBe(false)
    expect(isLocalEngineId({})).toBe(false)
  })

  it('exposes the id set it checks against', () => {
    expect([...LOCAL_ENGINE_IDS].sort()).toEqual([
      'litert-lm',
      'llamacpp',
      'mlx',
      'openvino',
    ])
  })

  it('knows the engines whose runtime Jan installs', () => {
    expect(isManagedCpuEngine('litert-lm')).toBe(true)
    expect(isManagedCpuEngine('openvino')).toBe(true)
    expect(isManagedCpuEngine('llamacpp')).toBe(false)
    expect(isManagedCpuEngine('mlx')).toBe(false)
    expect(MANAGED_CPU_ENGINES['litert-lm'].package).toBe('litert-lm')
  })

  it('only offers the local API server the engines it can serve', () => {
    expect(LOCAL_API_SERVER_ENGINES).toEqual(['llamacpp', 'mlx'])
    expect(LOCAL_API_SERVER_ENGINES).not.toContain('litert-lm')
    expect(LOCAL_API_SERVER_ENGINES).not.toContain('openvino')
  })
})
