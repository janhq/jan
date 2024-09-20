/**
 * @jest-environment jsdom
 */
jest.mock('@janhq/core', () => ({
  ...jest.requireActual('@janhq/core/node'),
  fs: {
    existsSync: jest.fn(),
    mkdir: jest.fn(),
    writeFileSync: jest.fn(),
    readdirSync: jest.fn(),
    readFileSync: jest.fn(),
    appendFileSync: jest.fn(),
    rm: jest.fn(),
    writeBlob: jest.fn(),
    joinPath: jest.fn(),
    fileStat: jest.fn(),
  },
  joinPath: jest.fn(),
  ConversationalExtension: jest.fn(),
}))

import { fs } from '@janhq/core'

import JSONConversationalExtension from '.'

describe('JSONConversationalExtension Tests', () => {
  let extension: JSONConversationalExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new JSONConversationalExtension()
  })

  it('should create thread folder on load if it does not exist', async () => {
    // @ts-ignore
    jest.spyOn(fs, 'existsSync').mockResolvedValue(false)
    const mkdirSpy = jest.spyOn(fs, 'mkdir').mockResolvedValue({})

    await extension.onLoad()

    expect(mkdirSpy).toHaveBeenCalledWith('file://threads')
  })

  it('should log message on unload', () => {
    const consoleSpy = jest.spyOn(console, 'debug').mockImplementation()

    extension.onUnload()

    expect(consoleSpy).toHaveBeenCalledWith(
      'JSONConversationalExtension unloaded'
    )
  })

  it('should return sorted threads', async () => {
    jest
      .spyOn(extension, 'getValidThreadDirs')
      .mockResolvedValue(['dir1', 'dir2'])
    jest
      .spyOn(extension, 'readThread')
      .mockResolvedValueOnce({ updated: '2023-01-01' })
      .mockResolvedValueOnce({ updated: '2023-01-02' })

    const threads = await extension.getThreads()

    expect(threads).toEqual([
      { updated: '2023-01-02' },
      { updated: '2023-01-01' },
    ])
  })

  it('should ignore broken threads', async () => {
    jest
      .spyOn(extension, 'getValidThreadDirs')
      .mockResolvedValue(['dir1', 'dir2'])
    jest
      .spyOn(extension, 'readThread')
      .mockResolvedValueOnce(JSON.stringify({ updated: '2023-01-01' }))
      .mockResolvedValueOnce('this_is_an_invalid_json_content')

    const threads = await extension.getThreads()

    expect(threads).toEqual([{ updated: '2023-01-01' }])
  })

  it('should save thread', async () => {
    // @ts-ignore
    jest.spyOn(fs, 'existsSync').mockResolvedValue(false)
    const mkdirSpy = jest.spyOn(fs, 'mkdir').mockResolvedValue({})
    const writeFileSyncSpy = jest
      .spyOn(fs, 'writeFileSync')
      .mockResolvedValue({})

    const thread = { id: '1', updated: '2023-01-01' } as any
    await extension.saveThread(thread)

    expect(mkdirSpy).toHaveBeenCalled()
    expect(writeFileSyncSpy).toHaveBeenCalled()
  })

  it('should delete thread', async () => {
    const rmSpy = jest.spyOn(fs, 'rm').mockResolvedValue({})

    await extension.deleteThread('1')

    expect(rmSpy).toHaveBeenCalled()
  })

  it('should add new message', async () => {
    // @ts-ignore
    jest.spyOn(fs, 'existsSync').mockResolvedValue(false)
    const mkdirSpy = jest.spyOn(fs, 'mkdir').mockResolvedValue({})
    const appendFileSyncSpy = jest
      .spyOn(fs, 'appendFileSync')
      .mockResolvedValue({})

    const message = {
      thread_id: '1',
      content: [{ type: 'text', text: { annotations: [] } }],
    } as any
    await extension.addNewMessage(message)

    expect(mkdirSpy).toHaveBeenCalled()
    expect(appendFileSyncSpy).toHaveBeenCalled()
  })

  it('should store image', async () => {
    const writeBlobSpy = jest.spyOn(fs, 'writeBlob').mockResolvedValue({})

    await extension.storeImage(
      'data:image/png;base64,abcd',
      'path/to/image.png'
    )

    expect(writeBlobSpy).toHaveBeenCalled()
  })

  it('should store file', async () => {
    const writeBlobSpy = jest.spyOn(fs, 'writeBlob').mockResolvedValue({})

    await extension.storeFile(
      'data:application/pdf;base64,abcd',
      'path/to/file.pdf'
    )

    expect(writeBlobSpy).toHaveBeenCalled()
  })

  it('should write messages', async () => {
    // @ts-ignore
    jest.spyOn(fs, 'existsSync').mockResolvedValue(false)
    const mkdirSpy = jest.spyOn(fs, 'mkdir').mockResolvedValue({})
    const writeFileSyncSpy = jest
      .spyOn(fs, 'writeFileSync')
      .mockResolvedValue({})

    const messages = [{ id: '1', thread_id: '1', content: [] }] as any
    await extension.writeMessages('1', messages)

    expect(mkdirSpy).toHaveBeenCalled()
    expect(writeFileSyncSpy).toHaveBeenCalled()
  })

  it('should get all messages on string response', async () => {
    jest.spyOn(fs, 'readdirSync').mockResolvedValue(['messages.jsonl'])
    jest.spyOn(fs, 'readFileSync').mockResolvedValue('{"id":"1"}\n{"id":"2"}\n')

    const messages = await extension.getAllMessages('1')

    expect(messages).toEqual([{ id: '1' }, { id: '2' }])
  })

  it('should get all messages on object response', async () => {
    jest.spyOn(fs, 'readdirSync').mockResolvedValue(['messages.jsonl'])
    jest.spyOn(fs, 'readFileSync').mockResolvedValue({ id: 1 })

    const messages = await extension.getAllMessages('1')

    expect(messages).toEqual([{ id: 1 }])
  })

  it('get all messages return empty on error', async () => {
    jest.spyOn(fs, 'readdirSync').mockRejectedValue(['messages.jsonl'])

    const messages = await extension.getAllMessages('1')

    expect(messages).toEqual([])
  })

  it('return empty messages on no messages file', async () => {
    jest.spyOn(fs, 'readdirSync').mockResolvedValue([])

    const messages = await extension.getAllMessages('1')

    expect(messages).toEqual([])
  })

  it('should ignore error message', async () => {
    jest.spyOn(fs, 'readdirSync').mockResolvedValue(['messages.jsonl'])
    jest
      .spyOn(fs, 'readFileSync')
      .mockResolvedValue('{"id":"1"}\nyolo\n{"id":"2"}\n')

    const messages = await extension.getAllMessages('1')

    expect(messages).toEqual([{ id: '1' }, { id: '2' }])
  })

  it('should create thread folder on load if it does not exist', async () => {
    // @ts-ignore
    jest.spyOn(fs, 'existsSync').mockResolvedValue(false)
    const mkdirSpy = jest.spyOn(fs, 'mkdir').mockResolvedValue({})

    await extension.onLoad()

    expect(mkdirSpy).toHaveBeenCalledWith('file://threads')
  })

  it('should log message on unload', () => {
    const consoleSpy = jest.spyOn(console, 'debug').mockImplementation()

    extension.onUnload()

    expect(consoleSpy).toHaveBeenCalledWith(
      'JSONConversationalExtension unloaded'
    )
  })

  it('should return sorted threads', async () => {
    jest
      .spyOn(extension, 'getValidThreadDirs')
      .mockResolvedValue(['dir1', 'dir2'])
    jest
      .spyOn(extension, 'readThread')
      .mockResolvedValueOnce({ updated: '2023-01-01' })
      .mockResolvedValueOnce({ updated: '2023-01-02' })

    const threads = await extension.getThreads()

    expect(threads).toEqual([
      { updated: '2023-01-02' },
      { updated: '2023-01-01' },
    ])
  })

  it('should ignore broken threads', async () => {
    jest
      .spyOn(extension, 'getValidThreadDirs')
      .mockResolvedValue(['dir1', 'dir2'])
    jest
      .spyOn(extension, 'readThread')
      .mockResolvedValueOnce(JSON.stringify({ updated: '2023-01-01' }))
      .mockResolvedValueOnce('this_is_an_invalid_json_content')

    const threads = await extension.getThreads()

    expect(threads).toEqual([{ updated: '2023-01-01' }])
  })

  it('should save thread', async () => {
    // @ts-ignore
    jest.spyOn(fs, 'existsSync').mockResolvedValue(false)
    const mkdirSpy = jest.spyOn(fs, 'mkdir').mockResolvedValue({})
    const writeFileSyncSpy = jest
      .spyOn(fs, 'writeFileSync')
      .mockResolvedValue({})

    const thread = { id: '1', updated: '2023-01-01' } as any
    await extension.saveThread(thread)

    expect(mkdirSpy).toHaveBeenCalled()
    expect(writeFileSyncSpy).toHaveBeenCalled()
  })

  it('should delete thread', async () => {
    const rmSpy = jest.spyOn(fs, 'rm').mockResolvedValue({})

    await extension.deleteThread('1')

    expect(rmSpy).toHaveBeenCalled()
  })

  it('should add new message', async () => {
    // @ts-ignore
    jest.spyOn(fs, 'existsSync').mockResolvedValue(false)
    const mkdirSpy = jest.spyOn(fs, 'mkdir').mockResolvedValue({})
    const appendFileSyncSpy = jest
      .spyOn(fs, 'appendFileSync')
      .mockResolvedValue({})

    const message = {
      thread_id: '1',
      content: [{ type: 'text', text: { annotations: [] } }],
    } as any
    await extension.addNewMessage(message)

    expect(mkdirSpy).toHaveBeenCalled()
    expect(appendFileSyncSpy).toHaveBeenCalled()
  })

  it('should add new image message', async () => {
    jest
      .spyOn(fs, 'existsSync')
      // @ts-ignore
      .mockResolvedValueOnce(false)
      // @ts-ignore
      .mockResolvedValueOnce(false)
      // @ts-ignore
      .mockResolvedValueOnce(true)
    const mkdirSpy = jest.spyOn(fs, 'mkdir').mockResolvedValue({})
    const appendFileSyncSpy = jest
      .spyOn(fs, 'appendFileSync')
      .mockResolvedValue({})
    jest.spyOn(fs, 'writeBlob').mockResolvedValue({})

    const message = {
      thread_id: '1',
      content: [
        { type: 'image', text: { annotations: ['data:image;base64,hehe'] } },
      ],
    } as any
    await extension.addNewMessage(message)

    expect(mkdirSpy).toHaveBeenCalled()
    expect(appendFileSyncSpy).toHaveBeenCalled()
  })

  it('should add new pdf message', async () => {
    jest
      .spyOn(fs, 'existsSync')
      // @ts-ignore
      .mockResolvedValueOnce(false)
      // @ts-ignore
      .mockResolvedValueOnce(false)
      // @ts-ignore
      .mockResolvedValueOnce(true)
    const mkdirSpy = jest.spyOn(fs, 'mkdir').mockResolvedValue({})
    const appendFileSyncSpy = jest
      .spyOn(fs, 'appendFileSync')
      .mockResolvedValue({})
    jest.spyOn(fs, 'writeBlob').mockResolvedValue({})

    const message = {
      thread_id: '1',
      content: [
        { type: 'pdf', text: { annotations: ['data:pdf;base64,hehe'] } },
      ],
    } as any
    await extension.addNewMessage(message)

    expect(mkdirSpy).toHaveBeenCalled()
    expect(appendFileSyncSpy).toHaveBeenCalled()
  })

  it('should store image', async () => {
    const writeBlobSpy = jest.spyOn(fs, 'writeBlob').mockResolvedValue({})

    await extension.storeImage(
      'data:image/png;base64,abcd',
      'path/to/image.png'
    )

    expect(writeBlobSpy).toHaveBeenCalled()
  })

  it('should store file', async () => {
    const writeBlobSpy = jest.spyOn(fs, 'writeBlob').mockResolvedValue({})

    await extension.storeFile(
      'data:application/pdf;base64,abcd',
      'path/to/file.pdf'
    )

    expect(writeBlobSpy).toHaveBeenCalled()
  })
})

describe('test readThread', () => {
  let extension: JSONConversationalExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new JSONConversationalExtension()
  })

  it('should read thread', async () => {
    jest
      .spyOn(fs, 'readFileSync')
      .mockResolvedValue(JSON.stringify({ id: '1' }))
    const thread = await extension.readThread('1')
    expect(thread).toEqual(`{"id":"1"}`)
  })

  it('getValidThreadDirs should return valid thread directories', async () => {
    jest
      .spyOn(fs, 'readdirSync')
      .mockResolvedValueOnce(['1', '2', '3'])
      .mockResolvedValueOnce(['thread.json'])
      .mockResolvedValueOnce(['thread.json'])
      .mockResolvedValueOnce([])
      // @ts-ignore
    jest.spyOn(fs, 'existsSync').mockResolvedValue(true)
    jest.spyOn(fs, 'fileStat').mockResolvedValue({
      isDirectory: true,
    } as any)
    const validThreadDirs = await extension.getValidThreadDirs()
    expect(validThreadDirs).toEqual(['1', '2'])
  })
})
