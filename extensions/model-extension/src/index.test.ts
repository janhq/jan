/**
 * @jest-environment jsdom
 */
const readDirSyncMock = jest.fn()
const existMock = jest.fn()
const readFileSyncMock = jest.fn()
const downloadMock = jest.fn()
const mkdirMock = jest.fn()
const writeFileSyncMock = jest.fn()
const copyFileMock = jest.fn()
const dirNameMock = jest.fn()
const executeMock = jest.fn()

jest.mock('@janhq/core', () => ({
  ...jest.requireActual('@janhq/core/node'),
  events: {
    emit: jest.fn(),
  },
  fs: {
    existsSync: existMock,
    readdirSync: readDirSyncMock,
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock,
    mkdir: mkdirMock,
    copyFile: copyFileMock,
    fileStat: () => ({
      isDirectory: false,
    }),
  },
  dirName: dirNameMock,
  joinPath: (paths) => paths.join('/'),
  ModelExtension: jest.fn(),
  downloadFile: downloadMock,
  executeOnMain: executeMock,
}))

jest.mock('@huggingface/gguf')

global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({ test: 100 }),
    arrayBuffer: jest.fn(),
  })
) as jest.Mock

import JanModelExtension from '.'
import { fs, dirName } from '@janhq/core'
import { gguf } from '@huggingface/gguf'

describe('JanModelExtension', () => {
  let sut: JanModelExtension

  beforeAll(() => {
    // @ts-ignore
    sut = new JanModelExtension()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getConfiguredModels', () => {
    describe("when there's no models are pre-populated", () => {
      it('should return empty array', async () => {
        // Mock configured models data
        const configuredModels = []
        existMock.mockReturnValue(true)
        readDirSyncMock.mockReturnValue([])

        const result = await sut.getConfiguredModels()
        expect(result).toEqual([])
      })
    })

    describe("when there's are pre-populated models - all flattened", () => {
      it('returns configured models data - flatten folder - with correct file_path and model id', async () => {
        // Mock configured models data
        const configuredModels = [
          {
            id: '1',
            name: 'Model 1',
            version: '1.0.0',
            description: 'Model 1 description',
            object: {
              type: 'model',
              uri: 'http://localhost:5000/models/model1',
            },
            format: 'onnx',
            sources: [],
            created: new Date(),
            updated: new Date(),
            parameters: {},
            settings: {},
            metadata: {},
            engine: 'test',
          } as any,
          {
            id: '2',
            name: 'Model 2',
            version: '2.0.0',
            description: 'Model 2 description',
            object: {
              type: 'model',
              uri: 'http://localhost:5000/models/model2',
            },
            format: 'onnx',
            sources: [],
            parameters: {},
            settings: {},
            metadata: {},
            engine: 'test',
          } as any,
        ]
        existMock.mockReturnValue(true)

        readDirSyncMock.mockImplementation((path) => {
          if (path === 'file://models') return ['model1', 'model2']
          else return ['model.json']
        })

        readFileSyncMock.mockImplementation((path) => {
          if (path.includes('model1'))
            return JSON.stringify(configuredModels[0])
          else return JSON.stringify(configuredModels[1])
        })

        const result = await sut.getConfiguredModels()
        expect(result).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              file_path: 'file://models/model1/model.json',
              id: '1',
            }),
            expect.objectContaining({
              file_path: 'file://models/model2/model.json',
              id: '2',
            }),
          ])
        )
      })
    })

    describe("when there's are pre-populated models - there are nested folders", () => {
      it('returns configured models data - flatten folder - with correct file_path and model id', async () => {
        // Mock configured models data
        const configuredModels = [
          {
            id: '1',
            name: 'Model 1',
            version: '1.0.0',
            description: 'Model 1 description',
            object: {
              type: 'model',
              uri: 'http://localhost:5000/models/model1',
            },
            format: 'onnx',
            sources: [],
            created: new Date(),
            updated: new Date(),
            parameters: {},
            settings: {},
            metadata: {},
            engine: 'test',
          } as any,
          {
            id: '2',
            name: 'Model 2',
            version: '2.0.0',
            description: 'Model 2 description',
            object: {
              type: 'model',
              uri: 'http://localhost:5000/models/model2',
            },
            format: 'onnx',
            sources: [],
            parameters: {},
            settings: {},
            metadata: {},
            engine: 'test',
          } as any,
        ]
        existMock.mockReturnValue(true)

        readDirSyncMock.mockImplementation((path) => {
          if (path === 'file://models') return ['model1', 'model2/model2-1']
          else return ['model.json']
        })

        readFileSyncMock.mockImplementation((path) => {
          if (path.includes('model1'))
            return JSON.stringify(configuredModels[0])
          else if (path.includes('model2/model2-1'))
            return JSON.stringify(configuredModels[1])
        })

        const result = await sut.getConfiguredModels()
        expect(result).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              file_path: 'file://models/model1/model.json',
              id: '1',
            }),
            expect.objectContaining({
              file_path: 'file://models/model2/model2-1/model.json',
              id: '2',
            }),
          ])
        )
      })
    })
  })

  describe('getDownloadedModels', () => {
    describe('no models downloaded', () => {
      it('should return empty array', async () => {
        // Mock downloaded models data
        existMock.mockReturnValue(true)
        readDirSyncMock.mockReturnValue([])

        const result = await sut.getDownloadedModels()
        expect(result).toEqual([])
      })
    })
    describe('only one model is downloaded', () => {
      describe('flatten folder', () => {
        it('returns downloaded models - with correct file_path and model id', async () => {
          // Mock configured models data
          const configuredModels = [
            {
              id: '1',
              name: 'Model 1',
              version: '1.0.0',
              description: 'Model 1 description',
              object: {
                type: 'model',
                uri: 'http://localhost:5000/models/model1',
              },
              format: 'onnx',
              sources: [],
              created: new Date(),
              updated: new Date(),
              parameters: {},
              settings: {},
              metadata: {},
              engine: 'test',
            } as any,
            {
              id: '2',
              name: 'Model 2',
              version: '2.0.0',
              description: 'Model 2 description',
              object: {
                type: 'model',
                uri: 'http://localhost:5000/models/model2',
              },
              format: 'onnx',
              sources: [],
              parameters: {},
              settings: {},
              metadata: {},
              engine: 'test',
            } as any,
          ]
          existMock.mockReturnValue(true)

          readDirSyncMock.mockImplementation((path) => {
            if (path === 'file://models') return ['model1', 'model2']
            else if (path === 'file://models/model1')
              return ['model.json', 'test.gguf']
            else return ['model.json']
          })

          readFileSyncMock.mockImplementation((path) => {
            if (path.includes('model1'))
              return JSON.stringify(configuredModels[0])
            else return JSON.stringify(configuredModels[1])
          })

          const result = await sut.getDownloadedModels()
          expect(result).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                file_path: 'file://models/model1/model.json',
                id: '1',
              }),
            ])
          )
        })
      })
    })

    describe('all models are downloaded', () => {
      describe('nested folders', () => {
        it('returns downloaded models - with correct file_path and model id', async () => {
          // Mock configured models data
          const configuredModels = [
            {
              id: '1',
              name: 'Model 1',
              version: '1.0.0',
              description: 'Model 1 description',
              object: {
                type: 'model',
                uri: 'http://localhost:5000/models/model1',
              },
              format: 'onnx',
              sources: [],
              created: new Date(),
              updated: new Date(),
              parameters: {},
              settings: {},
              metadata: {},
              engine: 'test',
            } as any,
            {
              id: '2',
              name: 'Model 2',
              version: '2.0.0',
              description: 'Model 2 description',
              object: {
                type: 'model',
                uri: 'http://localhost:5000/models/model2',
              },
              format: 'onnx',
              sources: [],
              parameters: {},
              settings: {},
              metadata: {},
              engine: 'test',
            } as any,
          ]
          existMock.mockReturnValue(true)

          readDirSyncMock.mockImplementation((path) => {
            if (path === 'file://models') return ['model1', 'model2/model2-1']
            else return ['model.json', 'test.gguf']
          })

          readFileSyncMock.mockImplementation((path) => {
            if (path.includes('model1'))
              return JSON.stringify(configuredModels[0])
            else return JSON.stringify(configuredModels[1])
          })

          const result = await sut.getDownloadedModels()
          expect(result).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                file_path: 'file://models/model1/model.json',
                id: '1',
              }),
              expect.objectContaining({
                file_path: 'file://models/model2/model2-1/model.json',
                id: '2',
              }),
            ])
          )
        })
      })
    })

    describe('all models are downloaded with uppercased GGUF files', () => {
      it('returns downloaded models - with correct file_path and model id', async () => {
        // Mock configured models data
        const configuredModels = [
          {
            id: '1',
            name: 'Model 1',
            version: '1.0.0',
            description: 'Model 1 description',
            object: {
              type: 'model',
              uri: 'http://localhost:5000/models/model1',
            },
            format: 'onnx',
            sources: [],
            created: new Date(),
            updated: new Date(),
            parameters: {},
            settings: {},
            metadata: {},
            engine: 'test',
          } as any,
          {
            id: '2',
            name: 'Model 2',
            version: '2.0.0',
            description: 'Model 2 description',
            object: {
              type: 'model',
              uri: 'http://localhost:5000/models/model2',
            },
            format: 'onnx',
            sources: [],
            parameters: {},
            settings: {},
            metadata: {},
            engine: 'test',
          } as any,
        ]
        existMock.mockReturnValue(true)

        readDirSyncMock.mockImplementation((path) => {
          if (path === 'file://models') return ['model1', 'model2/model2-1']
          else if (path === 'file://models/model1')
            return ['model.json', 'test.GGUF']
          else return ['model.json', 'test.gguf']
        })

        readFileSyncMock.mockImplementation((path) => {
          if (path.includes('model1'))
            return JSON.stringify(configuredModels[0])
          else return JSON.stringify(configuredModels[1])
        })

        const result = await sut.getDownloadedModels()
        expect(result).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              file_path: 'file://models/model1/model.json',
              id: '1',
            }),
            expect.objectContaining({
              file_path: 'file://models/model2/model2-1/model.json',
              id: '2',
            }),
          ])
        )
      })
    })

    describe('all models are downloaded - GGUF & Tensort RT', () => {
      it('returns downloaded models - with correct file_path and model id', async () => {
        // Mock configured models data
        const configuredModels = [
          {
            id: '1',
            name: 'Model 1',
            version: '1.0.0',
            description: 'Model 1 description',
            object: {
              type: 'model',
              uri: 'http://localhost:5000/models/model1',
            },
            format: 'onnx',
            sources: [],
            created: new Date(),
            updated: new Date(),
            parameters: {},
            settings: {},
            metadata: {},
            engine: 'test',
          } as any,
          {
            id: '2',
            name: 'Model 2',
            version: '2.0.0',
            description: 'Model 2 description',
            object: {
              type: 'model',
              uri: 'http://localhost:5000/models/model2',
            },
            format: 'onnx',
            sources: [],
            parameters: {},
            settings: {},
            metadata: {},
            engine: 'test',
          } as any,
        ]
        existMock.mockReturnValue(true)

        readDirSyncMock.mockImplementation((path) => {
          if (path === 'file://models') return ['model1', 'model2/model2-1']
          else if (path === 'file://models/model1')
            return ['model.json', 'test.gguf']
          else return ['model.json', 'test.engine']
        })

        readFileSyncMock.mockImplementation((path) => {
          if (path.includes('model1'))
            return JSON.stringify(configuredModels[0])
          else return JSON.stringify(configuredModels[1])
        })

        const result = await sut.getDownloadedModels()
        expect(result).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              file_path: 'file://models/model1/model.json',
              id: '1',
            }),
            expect.objectContaining({
              file_path: 'file://models/model2/model2-1/model.json',
              id: '2',
            }),
          ])
        )
      })
    })
  })

  describe('deleteModel', () => {
    describe('model is a GGUF model', () => {
      it('should delete the GGUF file', async () => {
        fs.unlinkSync = jest.fn()
        const dirMock = dirName as jest.Mock
        dirMock.mockReturnValue('file://models/model1')

        fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify({}))

        readDirSyncMock.mockImplementation((path) => {
          return ['model.json', 'test.gguf']
        })

        existMock.mockReturnValue(true)

        await sut.deleteModel({
          file_path: 'file://models/model1/model.json',
        } as any)

        expect(fs.unlinkSync).toHaveBeenCalledWith(
          'file://models/model1/test.gguf'
        )
      })

      it('no gguf file presented', async () => {
        fs.unlinkSync = jest.fn()
        const dirMock = dirName as jest.Mock
        dirMock.mockReturnValue('file://models/model1')

        fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify({}))

        readDirSyncMock.mockReturnValue(['model.json'])

        existMock.mockReturnValue(true)

        await sut.deleteModel({
          file_path: 'file://models/model1/model.json',
        } as any)

        expect(fs.unlinkSync).toHaveBeenCalledTimes(0)
      })

      it('delete an imported model', async () => {
        fs.rm = jest.fn()
        const dirMock = dirName as jest.Mock
        dirMock.mockReturnValue('file://models/model1')

        readDirSyncMock.mockReturnValue(['model.json', 'test.gguf'])

        // MARK: This is a tricky logic implement?
        // I will just add test for now but will align on the legacy implementation
        fs.readFileSync = jest.fn().mockReturnValue(
          JSON.stringify({
            metadata: {
              author: 'user',
            },
          })
        )

        existMock.mockReturnValue(true)

        await sut.deleteModel({
          file_path: 'file://models/model1/model.json',
        } as any)

        expect(fs.rm).toHaveBeenCalledWith('file://models/model1')
      })

      it('delete tensorrt-models', async () => {
        fs.rm = jest.fn()
        const dirMock = dirName as jest.Mock
        dirMock.mockReturnValue('file://models/model1')

        readDirSyncMock.mockReturnValue(['model.json', 'test.engine'])

        fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify({}))

        existMock.mockReturnValue(true)

        await sut.deleteModel({
          file_path: 'file://models/model1/model.json',
        } as any)

        expect(fs.unlinkSync).toHaveBeenCalledWith(
          'file://models/model1/test.engine'
        )
      })
    })
  })

  describe('downloadModel', () => {
    const model: any = {
      id: 'model-id',
      name: 'Test Model',
      sources: [
        { url: 'http://example.com/model.gguf', filename: 'model.gguf' },
      ],
      engine: 'test-engine',
    }

    const network = {
      ignoreSSL: true,
      proxy: 'http://proxy.example.com',
    }

    const gpuSettings: any = {
      gpus: [{ name: 'nvidia-rtx-3080', arch: 'ampere' }],
    }

    it('should reject with invalid gguf metadata', async () => {
      existMock.mockImplementation(() => false)

      expect(
        sut.downloadModel(model, gpuSettings, network)
      ).rejects.toBeTruthy()
    })

    it('should download corresponding ID', async () => {
      existMock.mockImplementation(() => true)
      dirNameMock.mockImplementation(() => 'file://models/model1')
      downloadMock.mockImplementation(() => {
        return Promise.resolve({})
      })

      expect(
        await sut.downloadModel(
          { ...model, file_path: 'file://models/model1/model.json' },
          gpuSettings,
          network
        )
      ).toBeUndefined()

      expect(downloadMock).toHaveBeenCalledWith(
        {
          localPath: 'file://models/model1/model.gguf',
          modelId: 'model-id',
          url: 'http://example.com/model.gguf',
        },
        { ignoreSSL: true, proxy: 'http://proxy.example.com' }
      )
    })

    it('should handle invalid model file', async () => {
      executeMock.mockResolvedValue({})

      fs.readFileSync = jest.fn(() => {
        return JSON.stringify({ metadata: { author: 'user' } })
      })

      expect(
        sut.downloadModel(
          { ...model, file_path: 'file://models/model1/model.json' },
          gpuSettings,
          network
        )
      ).resolves.not.toThrow()

      expect(downloadMock).not.toHaveBeenCalled()
    })
    it('should handle model file with no sources', async () => {
      executeMock.mockResolvedValue({})
      const modelWithoutSources = { ...model, sources: [] }

      expect(
        sut.downloadModel(
          {
            ...modelWithoutSources,
            file_path: 'file://models/model1/model.json',
          },
          gpuSettings,
          network
        )
      ).resolves.toBe(undefined)

      expect(downloadMock).not.toHaveBeenCalled()
    })

    it('should handle model file with multiple sources', async () => {
      const modelWithMultipleSources = {
        ...model,
        sources: [
          { url: 'http://example.com/model1.gguf', filename: 'model1.gguf' },
          { url: 'http://example.com/model2.gguf', filename: 'model2.gguf' },
        ],
      }

      executeMock.mockResolvedValue({
        metadata: { 'tokenizer.ggml.eos_token_id': 0 },
      })
      ;(gguf as jest.Mock).mockResolvedValue({
        metadata: { 'tokenizer.ggml.eos_token_id': 0 },
      })
      // @ts-ignore
      global.NODE = 'node'
      // @ts-ignore
      global.DEFAULT_MODEL = {
        parameters: { stop: [] },
      }
      downloadMock.mockImplementation(() => {
        return Promise.resolve({})
      })

      expect(
        await sut.downloadModel(
          {
            ...modelWithMultipleSources,
            file_path: 'file://models/model1/model.json',
          },
          gpuSettings,
          network
        )
      ).toBeUndefined()

      expect(downloadMock).toHaveBeenCalledWith(
        {
          localPath: 'file://models/model1/model1.gguf',
          modelId: 'model-id',
          url: 'http://example.com/model1.gguf',
        },
        { ignoreSSL: true, proxy: 'http://proxy.example.com' }
      )

      expect(downloadMock).toHaveBeenCalledWith(
        {
          localPath: 'file://models/model1/model2.gguf',
          modelId: 'model-id',
          url: 'http://example.com/model2.gguf',
        },
        { ignoreSSL: true, proxy: 'http://proxy.example.com' }
      )
    })

    it('should handle model file with no file_path', async () => {
      executeMock.mockResolvedValue({
        metadata: { 'tokenizer.ggml.eos_token_id': 0 },
      })
      ;(gguf as jest.Mock).mockResolvedValue({
        metadata: { 'tokenizer.ggml.eos_token_id': 0 },
      })
      // @ts-ignore
      global.NODE = 'node'
      // @ts-ignore
      global.DEFAULT_MODEL = {
        parameters: { stop: [] },
      }
      const modelWithoutFilepath = { ...model, file_path: undefined }

      await sut.downloadModel(modelWithoutFilepath, gpuSettings, network)

      expect(downloadMock).toHaveBeenCalledWith(
        expect.objectContaining({
          localPath: 'file://models/model-id/model.gguf',
        }),
        expect.anything()
      )
    })

    it('should handle model file with invalid file_path', async () => {
      executeMock.mockResolvedValue({
        metadata: { 'tokenizer.ggml.eos_token_id': 0 },
      })
      ;(gguf as jest.Mock).mockResolvedValue({
        metadata: { 'tokenizer.ggml.eos_token_id': 0 },
      })
      // @ts-ignore
      global.NODE = 'node'
      // @ts-ignore
      global.DEFAULT_MODEL = {
        parameters: { stop: [] },
      }
      const modelWithInvalidFilepath = {
        ...model,
        file_path: 'file://models/invalid-model.json',
      }

      await sut.downloadModel(modelWithInvalidFilepath, gpuSettings, network)

      expect(downloadMock).toHaveBeenCalledWith(
        expect.objectContaining({
          localPath: 'file://models/model1/model.gguf',
        }),
        expect.anything()
      )
    })

    it('should handle model with valid chat_template', async () => {
      executeMock.mockResolvedValue('{prompt}')
      ;(gguf as jest.Mock).mockResolvedValue({
        metadata: {},
      })
      // @ts-ignore
      global.NODE = 'node'
      // @ts-ignore
      global.DEFAULT_MODEL = {
        parameters: { stop: [] },
        settings: {
          prompt_template: '<|im-start|>{prompt}<|im-end|>',
        },
      }

      const result = await sut.retrieveGGUFMetadata({})

      expect(result).toEqual({
        parameters: {
          stop: [],
        },
        settings: {
          ctx_len: 4096,
          ngl: 33,
          prompt_template: '{prompt}',
        },
      })
    })

    it('should handle model without chat_template', async () => {
      executeMock.mockRejectedValue({})
      ;(gguf as jest.Mock).mockResolvedValue({
        metadata: {},
      })
      // @ts-ignore
      global.NODE = 'node'
      // @ts-ignore
      global.DEFAULT_MODEL = {
        parameters: { stop: [] },
        settings: {
          prompt_template: '<|im-start|>{prompt}<|im-end|>',
        },
      }

      const result = await sut.retrieveGGUFMetadata({})

      expect(result).toEqual({
        parameters: {
          stop: [],
        },
        settings: {
          ctx_len: 4096,
          ngl: 33,
          prompt_template: '<|im-start|>{prompt}<|im-end|>',
        },
      })
    })
  })
})
