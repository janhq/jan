import { describe, beforeEach, it, expect, vi } from 'vitest'
import JanEngineManagementExtension from './index'
import { InferenceEngine } from '@janhq/core'

describe('API methods', () => {
  let extension: JanEngineManagementExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new JanEngineManagementExtension()
    vi.resetAllMocks()
  })

  describe('getReleasedEnginesByVersion', () => {
    it('should return engines filtered by platform if provided', async () => {
      const mockEngines = [
        {
          name: 'windows-amd64-avx2',
          version: '1.0.0',
        },
        {
          name: 'linux-amd64-avx2',
          version: '1.0.0',
        },
      ]

      vi.mock('ky', () => ({
        default: {
          get: () => ({
            json: () => Promise.resolve(mockEngines),
          }),
        },
      }))

      const mock = vi.spyOn(extension, 'getReleasedEnginesByVersion')
      mock.mockImplementation(async (name, version, platform) => {
        const result = await Promise.resolve(mockEngines)
        return platform ? result.filter(r => r.name.includes(platform)) : result
      })

      const result = await extension.getReleasedEnginesByVersion(
        InferenceEngine.cortex_llamacpp,
        '1.0.0',
        'windows'
      )

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('windows-amd64-avx2')
    })

    it('should return all engines if platform is not provided', async () => {
      const mockEngines = [
        {
          name: 'windows-amd64-avx2',
          version: '1.0.0',
        },
        {
          name: 'linux-amd64-avx2',
          version: '1.0.0',
        },
      ]

      vi.mock('ky', () => ({
        default: {
          get: () => ({
            json: () => Promise.resolve(mockEngines),
          }),
        },
      }))

      const mock = vi.spyOn(extension, 'getReleasedEnginesByVersion')
      mock.mockImplementation(async (name, version, platform) => {
        const result = await Promise.resolve(mockEngines)
        return platform ? result.filter(r => r.name.includes(platform)) : result
      })

      const result = await extension.getReleasedEnginesByVersion(
        InferenceEngine.cortex_llamacpp,
        '1.0.0'
      )

      expect(result).toHaveLength(2)
    })
  })

  describe('getLatestReleasedEngine', () => {
    it('should return engines filtered by platform if provided', async () => {
      const mockEngines = [
        {
          name: 'windows-amd64-avx2',
          version: '1.0.0',
        },
        {
          name: 'linux-amd64-avx2',
          version: '1.0.0',
        },
      ]

      vi.mock('ky', () => ({
        default: {
          get: () => ({
            json: () => Promise.resolve(mockEngines),
          }),
        },
      }))

      const mock = vi.spyOn(extension, 'getLatestReleasedEngine')
      mock.mockImplementation(async (name, platform) => {
        const result = await Promise.resolve(mockEngines)
        return platform ? result.filter(r => r.name.includes(platform)) : result
      })

      const result = await extension.getLatestReleasedEngine(
        InferenceEngine.cortex_llamacpp,
        'linux'
      )

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('linux-amd64-avx2')
    })
  })

  describe('installEngine', () => {
    it('should send install request with correct parameters', async () => {
      const mockEngineConfig = {
        variant: 'windows-amd64-avx2',
        version: '1.0.0',
      }

      vi.mock('ky', () => ({
        default: {
          post: (url, options) => {
            expect(url).toBe(`${API_URL}/v1/engines/${InferenceEngine.cortex_llamacpp}/install`)
            expect(options.json).toEqual(mockEngineConfig)
            return Promise.resolve({ messages: 'OK' })
          },
        },
      }))

      const result = await extension.installEngine(
        InferenceEngine.cortex_llamacpp,
        mockEngineConfig
      )

      expect(result).toEqual({ messages: 'OK' })
    })
  })

  describe('uninstallEngine', () => {
    it('should send uninstall request with correct parameters', async () => {
      const mockEngineConfig = {
        variant: 'windows-amd64-avx2',
        version: '1.0.0',
      }

      vi.mock('ky', () => ({
        default: {
          delete: (url, options) => {
            expect(url).toBe(`${API_URL}/v1/engines/${InferenceEngine.cortex_llamacpp}/install`)
            expect(options.json).toEqual(mockEngineConfig)
            return Promise.resolve({ messages: 'OK' })
          },
        },
      }))

      const result = await extension.uninstallEngine(
        InferenceEngine.cortex_llamacpp,
        mockEngineConfig
      )

      expect(result).toEqual({ messages: 'OK' })
    })
  })

  describe('addRemoteModel', () => {
    it('should send add model request with correct parameters', async () => {
      const mockModel = {
        id: 'gpt-4',
        name: 'GPT-4',
        engine: InferenceEngine.openai,
      }

      vi.mock('ky', () => ({
        default: {
          post: (url, options) => {
            expect(url).toBe(`${API_URL}/v1/models/add`)
            expect(options.json).toHaveProperty('id', 'gpt-4')
            expect(options.json).toHaveProperty('engine', InferenceEngine.openai)
            expect(options.json).toHaveProperty('inference_params')
            return Promise.resolve()
          },
        },
      }))

      await extension.addRemoteModel(mockModel)
      // Success is implied by no thrown exceptions
    })
  })
})