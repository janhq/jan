import { openExternalUrl } from './core'
import { joinPath } from './core'
import { openFileExplorer } from './core'
import { getJanDataFolderPath } from './core'
import { executeOnMain } from './core'

describe('test core apis', () => {
  it('should open external url', async () => {
    const url = 'http://example.com'
    globalThis.core = {
      api: {
        openExternalUrl: jest.fn().mockResolvedValue('opened'),
      },
    }
    const result = await openExternalUrl(url)
    expect(globalThis.core.api.openExternalUrl).toHaveBeenCalledWith(url)
    expect(result).toBe('opened')
  })

  it('should join paths', async () => {
    const paths = ['/path/one', '/path/two']
    globalThis.core = {
      api: {
        joinPath: jest.fn().mockResolvedValue('/path/one/path/two'),
      },
    }
    const result = await joinPath(paths)
    expect(globalThis.core.api.joinPath).toHaveBeenCalledWith(paths)
    expect(result).toBe('/path/one/path/two')
  })

  it('should open file explorer', async () => {
    const path = '/path/to/open'
    globalThis.core = {
      api: {
        openFileExplorer: jest.fn().mockResolvedValue('opened'),
      },
    }
    const result = await openFileExplorer(path)
    expect(globalThis.core.api.openFileExplorer).toHaveBeenCalledWith(path)
    expect(result).toBe('opened')
  })

  it('should get jan data folder path', async () => {
    globalThis.core = {
      api: {
        getJanDataFolderPath: jest.fn().mockResolvedValue('/path/to/jan/data'),
      },
    }
    const result = await getJanDataFolderPath()
    expect(globalThis.core.api.getJanDataFolderPath).toHaveBeenCalled()
    expect(result).toBe('/path/to/jan/data')
  })

  it('should execute function on main process', async () => {
    const extension = 'testExtension'
    const method = 'testMethod'
    const args = ['arg1', 'arg2']
    globalThis.core = {
      api: {
        invokeExtensionFunc: jest.fn().mockResolvedValue('result'),
      },
    }
    const result = await executeOnMain(extension, method, ...args)
    expect(globalThis.core.api.invokeExtensionFunc).toHaveBeenCalledWith(extension, method, ...args)
    expect(result).toBe('result')
  })
})

describe('dirName - just a pass thru api', () => {
  it('should retrieve the directory name from a file path', async () => {
    const mockDirName = jest.fn()
    globalThis.core = {
      api: {
        dirName: mockDirName.mockResolvedValue('/path/to'),
      },
    }
    // Normal file path with extension
    const path = '/path/to/file.txt'
    await globalThis.core.api.dirName(path)
    expect(mockDirName).toHaveBeenCalledWith(path)
  })
})
