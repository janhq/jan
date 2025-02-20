import { describe, it, expect, beforeEach, vi } from 'vitest'
import { scanModelsFolder, getModelJsonPath } from './model-json'

// Mock the @janhq/core module
vi.mock('@janhq/core', () => ({
  InferenceEngine: {
    nitro: 'nitro',
  },
  fs: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    fileStat: vi.fn(),
    readFileSync: vi.fn(),
  },
  joinPath: vi.fn((paths) => paths.join('/')),
}))

// Import the mocked fs and joinPath after the mock is set up
import { fs } from '@janhq/core'

describe('model-json', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('scanModelsFolder', () => {
    it('should return an empty array when models folder does not exist', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false)

      const result = await scanModelsFolder()
      expect(result).toEqual([])
    })

    it('should return an array of models when valid model folders exist', async () => {
      const mockModelJson = {
        id: 'test-model',
        sources: [
          {
            filename: 'test-model',
            url: 'file://models/test-model/test-model.gguf',
          },
        ],
      }

      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.spyOn(fs, 'readdirSync').mockReturnValueOnce(['test-model'])
      vi.spyOn(fs, 'fileStat').mockResolvedValue({ isDirectory: () => true })
      vi.spyOn(fs, 'readFileSync').mockReturnValue(
        JSON.stringify(mockModelJson)
      )
      vi.spyOn(fs, 'readdirSync').mockReturnValueOnce([
        'test-model.gguf',
        'model.json',
      ])

      const result = await scanModelsFolder()
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject(mockModelJson)
    })
  })

  describe('getModelJsonPath', () => {
    it('should return undefined when folder does not exist', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false)

      const result = await getModelJsonPath('non-existent-folder')
      expect(result).toBeUndefined()
    })

    it('should return the path when model.json exists in the root folder', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['model.json'])

      const result = await getModelJsonPath('test-folder')
      expect(result).toBe('test-folder/model.json')
    })

    it('should return the path when model.json exists in a subfolder', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.spyOn(fs, 'readdirSync')
        .mockReturnValueOnce(['subfolder'])
        .mockReturnValueOnce(['model.json'])
      vi.spyOn(fs, 'fileStat').mockResolvedValue({ isDirectory: () => true })

      const result = await getModelJsonPath('test-folder')
      expect(result).toBe('test-folder/subfolder/model.json')
    })
  })
})
