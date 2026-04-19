import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultProvidersService } from '../default'

describe('DefaultProvidersService', () => {
  let svc: DefaultProvidersService

  beforeEach(() => {
    svc = new DefaultProvidersService()
    vi.restoreAllMocks()
  })

  describe('getProviders', () => {
    it('returns empty array', async () => {
      const result = await svc.getProviders()
      expect(result).toEqual([])
    })
  })

  describe('fetchModelsFromProvider', () => {
    it('returns empty array', async () => {
      const result = await svc.fetchModelsFromProvider({
        provider: 'test',
        active: false,
        base_url: 'https://example.com',
        models: [],
      } as any)
      expect(result).toEqual([])
    })
  })

  describe('updateSettings', () => {
    it('resolves without error', async () => {
      await expect(
        svc.updateSettings('test-provider', [
          { key: 'api_key', controller_type: 'input', controller_props: { value: 'sk-123' } } as any,
        ])
      ).resolves.toBeUndefined()
    })
  })

  describe('fetch', () => {
    it('returns the global fetch function', () => {
      const result = svc.fetch()
      expect(result).toBe(fetch)
    })
  })
})
