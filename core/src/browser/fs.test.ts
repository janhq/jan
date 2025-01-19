import { fs } from './fs'

describe('fs module', () => {
  beforeEach(() => {
    globalThis.core = {
      api: {
        writeFileSync: jest.fn(),
        readFileSync: jest.fn(),
        existsSync: jest.fn(),
        readdirSync: jest.fn(),
        mkdir: jest.fn(),
        rm: jest.fn(),
        unlinkSync: jest.fn(),
        getGgufFiles: jest.fn(),
        fileStat: jest.fn(),
      },
    }
  })

  it('should call writeFileSync with correct arguments', () => {
    const args = ['path/to/file', 'data']
    fs.writeFileSync(...args)
    expect(globalThis.core.api.writeFileSync).toHaveBeenCalledWith(...args)
  })

  it('should call readFileSync with correct arguments', () => {
    const args = ['path/to/file']
    fs.readFileSync(...args)
    expect(globalThis.core.api.readFileSync).toHaveBeenCalledWith(...args)
  })

  it('should call existsSync with correct arguments', () => {
    const args = ['path/to/file']
    fs.existsSync(...args)
    expect(globalThis.core.api.existsSync).toHaveBeenCalledWith(...args)
  })

  it('should call readdirSync with correct arguments', () => {
    const args = ['path/to/directory']
    fs.readdirSync(...args)
    expect(globalThis.core.api.readdirSync).toHaveBeenCalledWith(...args)
  })

  it('should call mkdir with correct arguments', () => {
    const args = ['path/to/directory']
    fs.mkdir(...args)
    expect(globalThis.core.api.mkdir).toHaveBeenCalledWith(...args)
  })

  it('should call rm with correct arguments', () => {
    const args = ['path/to/directory']
    fs.rm(...args)
    expect(globalThis.core.api.rm).toHaveBeenCalledWith(...args, {
      recursive: true,
      force: true,
    })
  })

  it('should call unlinkSync with correct arguments', () => {
    const args = ['path/to/file']
    fs.unlinkSync(...args)
    expect(globalThis.core.api.unlinkSync).toHaveBeenCalledWith(...args)
  })

  it('should call getGgufFiles with correct arguments', async () => {
    const paths = ['path/to/file1', 'path/to/file2']
    await fs.getGgufFiles(paths)
    expect(globalThis.core.api.getGgufFiles).toHaveBeenCalledWith(paths)
  })

  it('should call fileStat with correct arguments', async () => {
    const path = 'path/to/file'
    const outsideJanDataFolder = true
    await fs.fileStat(path, outsideJanDataFolder)
    expect(globalThis.core.api.fileStat).toHaveBeenCalledWith(
      path,
      outsideJanDataFolder
    )
  })
})
