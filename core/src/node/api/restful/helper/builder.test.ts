import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  rmdirSync,
} from 'fs'
import { join } from 'path'
import {
  getBuilder,
  retrieveBuilder,
  deleteBuilder,
  getMessages,
  retrieveMessage,
  createThread,
  updateThread,
  createMessage,
  downloadModel,
  chatCompletions,
} from './builder'
import { RouteConfiguration } from './configuration'

jest.mock('fs')
jest.mock('path')
jest.mock('../../../helper', () => ({
  getEngineConfiguration: jest.fn(),
  getJanDataFolderPath: jest.fn().mockReturnValue('/mock/path'),
}))
jest.mock('request')
jest.mock('request-progress')
jest.mock('node-fetch')

describe('builder helper functions', () => {
  const mockConfiguration: RouteConfiguration = {
    dirName: 'mockDir',
    metadataFileName: 'metadata.json',
    delete: {
      object: 'mockObject',
    },
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getBuilder', () => {
    it('should return an empty array if directory does not exist', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(false)
      const result = await getBuilder(mockConfiguration)
      expect(result).toEqual([])
    })

    it('should return model data if directory exists', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(true)
      ;(readdirSync as jest.Mock).mockReturnValue(['file1'])
      ;(readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ id: 'model1' }))

      const result = await getBuilder(mockConfiguration)
      expect(result).toEqual([{ id: 'model1' }])
    })
  })

  describe('retrieveBuilder', () => {
    it('should return undefined if no data matches the id', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(true)
      ;(readdirSync as jest.Mock).mockReturnValue(['file1'])
      ;(readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ id: 'model1' }))

      const result = await retrieveBuilder(mockConfiguration, 'nonexistentId')
      expect(result).toBeUndefined()
    })

    it('should return the matching data', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(true)
      ;(readdirSync as jest.Mock).mockReturnValue(['file1'])
      ;(readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ id: 'model1' }))

      const result = await retrieveBuilder(mockConfiguration, 'model1')
      expect(result).toEqual({ id: 'model1' })
    })
  })

  describe('deleteBuilder', () => {
    it('should return a message if trying to delete Jan assistant', async () => {
      const result = await deleteBuilder({ ...mockConfiguration, dirName: 'assistants' }, 'jan')
      expect(result).toEqual({ message: 'Cannot delete Jan assistant' })
    })

    it('should return a message if data is not found', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(true)
      ;(readdirSync as jest.Mock).mockReturnValue(['file1'])
      ;(readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ id: 'model1' }))

      const result = await deleteBuilder(mockConfiguration, 'nonexistentId')
      expect(result).toEqual({ message: 'Not found' })
    })

    it('should delete the directory and return success message', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(true)
      ;(readdirSync as jest.Mock).mockReturnValue(['file1'])
      ;(readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ id: 'model1' }))

      const result = await deleteBuilder(mockConfiguration, 'model1')
      expect(rmdirSync).toHaveBeenCalledWith(join('/mock/path', 'mockDir', 'model1'), {
        recursive: true,
      })
      expect(result).toEqual({ id: 'model1', object: 'mockObject', deleted: true })
    })
  })

  describe('getMessages', () => {
    it('should return an empty array if message file does not exist', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(false)

      const result = await getMessages('thread1')
      expect(result).toEqual([])
    })

    it('should return messages if message file exists', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(true)
      ;(readdirSync as jest.Mock).mockReturnValue(['messages.jsonl'])
      ;(readFileSync as jest.Mock).mockReturnValue('{"id":"msg1"}\n{"id":"msg2"}\n')

      const result = await getMessages('thread1')
      expect(result).toEqual([{ id: 'msg1' }, { id: 'msg2' }])
    })
  })

  describe('retrieveMessage', () => {
    it('should return a message if no messages match the id', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(true)
      ;(readdirSync as jest.Mock).mockReturnValue(['messages.jsonl'])
      ;(readFileSync as jest.Mock).mockReturnValue('{"id":"msg1"}\n')

      const result = await retrieveMessage('thread1', 'nonexistentId')
      expect(result).toEqual({ message: 'Not found' })
    })

    it('should return the matching message', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(true)
      ;(readdirSync as jest.Mock).mockReturnValue(['messages.jsonl'])
      ;(readFileSync as jest.Mock).mockReturnValue('{"id":"msg1"}\n')

      const result = await retrieveMessage('thread1', 'msg1')
      expect(result).toEqual({ id: 'msg1' })
    })
  })

  describe('createThread', () => {
    it('should return a message if thread has no assistants', async () => {
      const result = await createThread({})
      expect(result).toEqual({ message: 'Thread must have at least one assistant' })
    })

    it('should create a thread and return the updated thread', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(false)

      const thread = { assistants: [{ assistant_id: 'assistant1' }] }
      const result = await createThread(thread)
      expect(mkdirSync).toHaveBeenCalled()
      expect(writeFileSync).toHaveBeenCalled()
      expect(result.id).toBeDefined()
    })
  })

  describe('updateThread', () => {
    it('should return a message if thread is not found', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(true)
      ;(readdirSync as jest.Mock).mockReturnValue(['file1'])
      ;(readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ id: 'model1' }))

      const result = await updateThread('nonexistentId', {})
      expect(result).toEqual({ message: 'Thread not found' })
    })

    it('should update the thread and return the updated thread', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(true)
      ;(readdirSync as jest.Mock).mockReturnValue(['file1'])
      ;(readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ id: 'model1' }))

      const result = await updateThread('model1', { name: 'updatedName' })
      expect(writeFileSync).toHaveBeenCalled()
      expect(result.name).toEqual('updatedName')
    })
  })

  describe('createMessage', () => {
    it('should create a message and return the created message', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(false)
      const message = { role: 'user', content: 'Hello' }

      const result = (await createMessage('thread1', message)) as any
      expect(mkdirSync).toHaveBeenCalled()
      expect(appendFileSync).toHaveBeenCalled()
      expect(result.id).toBeDefined()
    })
  })

  describe('downloadModel', () => {
    it('should return a message if model is not found', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(true)
      ;(readdirSync as jest.Mock).mockReturnValue(['file1'])
      ;(readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ id: 'model1' }))

      const result = await downloadModel('nonexistentId')
      expect(result).toEqual({ message: 'Model not found' })
    })

    it('should start downloading the model', async () => {
      ;(existsSync as jest.Mock).mockReturnValue(true)
      ;(readdirSync as jest.Mock).mockReturnValue(['file1'])
      ;(readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ id: 'model1', object: 'model', sources: ['http://example.com'] })
      )
      const result = await downloadModel('model1')
      expect(result).toEqual({ message: 'Starting download model1' })
    })
  })

  describe('chatCompletions', () => {
    it('should return an error if model is not found', async () => {
      const request = { body: { model: 'nonexistentModel' } }
      const reply = { code: jest.fn().mockReturnThis(), send: jest.fn() }

      await chatCompletions(request, reply)
      expect(reply.code).toHaveBeenCalledWith(404)
      expect(reply.send).toHaveBeenCalledWith({
        error: {
          message: 'The model nonexistentModel does not exist',
          type: 'invalid_request_error',
          param: null,
          code: 'model_not_found',
        },
      })
    })

    it('should return the chat completions', async () => {
      const request = { body: { model: 'model1' } }
      const reply = {
        code: jest.fn().mockReturnThis(),
        send: jest.fn(),
        raw: { writeHead: jest.fn(), pipe: jest.fn() },
      }

      ;(existsSync as jest.Mock).mockReturnValue(true)
      ;(readdirSync as jest.Mock).mockReturnValue(['file1'])
      ;(readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ id: 'model1', engine: 'openai' })
      )

      // Mock fetch
      const fetch = require('node-fetch')
      fetch.mockResolvedValue({
        status: 200,
        body: { pipe: jest.fn() },
        json: jest.fn().mockResolvedValue({ completions: ['completion1'] }),
      })
      await chatCompletions(request, reply)
      expect(reply.raw.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    })
  })
})
