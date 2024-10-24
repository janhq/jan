import { scanModelsFolder, getModelJsonPath } from './model-json'

// Mock the @janhq/core module
jest.mock('@janhq/core', () => ({
  fs: {
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
    fileStat: jest.fn(),
    readFileSync: jest.fn(),
  },
  joinPath: jest.fn((paths) => paths.join('/')),
}))

// Import the mocked fs and joinPath after the mock is set up
const { fs } = jest.requireMock('@janhq/core')

describe('model-json', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('scanModelsFolder', () => {
    it('should return an empty array when models folder does not exist', async () => {
      fs.existsSync.mockReturnValue(false)

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

      fs.existsSync.mockReturnValue(true)
      fs.readdirSync.mockReturnValueOnce(['test-model'])
      fs.fileStat.mockResolvedValue({ isDirectory: () => true })
      fs.readFileSync.mockReturnValue(JSON.stringify(mockModelJson))
      fs.readdirSync.mockReturnValueOnce(['test-model.gguf', 'model.json'])

      const result = await scanModelsFolder()
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject(mockModelJson)
    })
  })

  describe('getModelJsonPath', () => {
    it('should return undefined when folder does not exist', async () => {
      fs.existsSync.mockReturnValue(false)

      const result = await getModelJsonPath('non-existent-folder')
      expect(result).toBeUndefined()
    })

    it('should return the path when model.json exists in the root folder', async () => {
      fs.existsSync.mockReturnValue(true)
      fs.readdirSync.mockReturnValue(['model.json'])

      const result = await getModelJsonPath('test-folder')
      expect(result).toBe('test-folder/model.json')
    })

    it('should return the path when model.json exists in a subfolder', async () => {
      fs.existsSync.mockReturnValue(true)
      fs.readdirSync
        .mockReturnValueOnce(['subfolder'])
        .mockReturnValueOnce(['model.json'])
      fs.fileStat.mockResolvedValue({ isDirectory: () => true })

      const result = await getModelJsonPath('test-folder')
      expect(result).toBe('test-folder/subfolder/model.json')
    })
  })
})
