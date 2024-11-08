import {
  fetchHuggingFaceRepoData,
  toHuggingFaceUrl,
  InvalidHostError,
} from './huggingface'
import { getFileSize } from '@janhq/core'

// Mock the getFileSize function
jest.mock('@janhq/core', () => ({
  getFileSize: jest.fn(),
  AllQuantizations: ['q4_0', 'q4_1', 'q5_0', 'q5_1', 'q8_0'],
}))

describe('huggingface utils', () => {
  let originalFetch: typeof global.fetch

  beforeAll(() => {
    originalFetch = global.fetch
    global.fetch = jest.fn()
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  beforeEach(() => {
    jest.resetAllMocks()
  })

  describe('fetchHuggingFaceRepoData', () => {
    it('should fetch and process repo data correctly', async () => {
      const mockResponse = {
        tags: ['gguf'],
        siblings: [
          { rfilename: 'model-q4_0.gguf' },
          { rfilename: 'model-q8_0.gguf' },
        ],
      }

      ;(global.fetch as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockResponse),
      })
      ;(getFileSize as jest.Mock).mockResolvedValue(1000000)

      const result = await fetchHuggingFaceRepoData('user/repo')

      expect(result.tags).toEqual(['gguf'])
      expect(result.siblings).toHaveLength(2)
      expect(result.siblings[0].fileSize).toBe(1000000)
      expect(result.siblings[0].quantization).toBe('q4_0')
      expect(result.modelUrl).toBe('https://huggingface.co/user/repo')
    })

    it('should throw an error if the model is not GGUF', async () => {
      const mockResponse = {
        tags: ['not-gguf'],
      }

      ;(global.fetch as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockResponse),
      })

      await expect(fetchHuggingFaceRepoData('user/repo')).rejects.toThrow(
        'user/repo is not supported. Only GGUF models are supported.'
      )
    })

    // ... existing code ...
  })

  describe('toHuggingFaceUrl', () => {
    it('should convert a valid repo ID to a Hugging Face API URL', () => {
      expect(toHuggingFaceUrl('user/repo')).toBe(
        'https://huggingface.co/api/models/user/repo'
      )
    })

    it('should handle a full Hugging Face URL', () => {
      expect(toHuggingFaceUrl('https://huggingface.co/user/repo')).toBe(
        'https://huggingface.co/api/models/user/repo'
      )
    })

    it('should throw an InvalidHostError for non-Hugging Face URLs', () => {
      expect(() => toHuggingFaceUrl('https://example.com/user/repo')).toThrow(
        InvalidHostError
      )
    })

    it('should throw an error for invalid URLs', () => {
      expect(() => toHuggingFaceUrl('https://invalid-url')).toThrow(
        'Invalid Hugging Face repo URL: https://invalid-url'
      )
    })
  })
})
