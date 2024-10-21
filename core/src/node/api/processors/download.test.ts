import { Downloader } from './download'
import { DownloadEvent } from '../../../types/api'
import { DownloadManager } from '../../helper/download'

jest.mock('../../helper', () => ({
  getJanDataFolderPath: jest.fn().mockReturnValue('path/to/folder'),
}))

jest.mock('../../helper/path', () => ({
  validatePath: jest.fn().mockReturnValue('path/to/folder'),
  normalizeFilePath: () =>
    process.platform === 'win32' ? 'C:\\Users\\path\\to\\file.gguf' : '/Users/path/to/file.gguf',
}))

jest.mock(
  'request',
  jest.fn().mockReturnValue(() => ({
    on: jest.fn(),
  }))
)

jest.mock('fs', () => ({
  createWriteStream: jest.fn(),
}))

jest.mock('request-progress', () => {
  return jest.fn().mockImplementation(() => {
    return {
      on: jest.fn().mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('Download failed'))
        }
        return {
          on: jest.fn().mockImplementation((event, callback) => {
            if (event === 'error') {
              callback(new Error('Download failed'))
            }
            return {
              on: jest.fn().mockImplementation((event, callback) => {
                if (event === 'error') {
                  callback(new Error('Download failed'))
                }
                return { pipe: jest.fn() }
              }),
            }
          }),
        }
      }),
    }
  })
})

describe('Downloader', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })
  it('should handle getFileSize errors correctly', async () => {
    const observer = jest.fn()
    const url = 'http://example.com/file'

    const downloader = new Downloader(observer)
    const requestMock = jest.fn((options, callback) => {
      callback(new Error('Test error'), null)
    })
    jest.mock('request', () => requestMock)

    await expect(downloader.getFileSize(observer, url)).rejects.toThrow('Test error')
  })

  it('should pause download correctly', () => {
    const observer = jest.fn()
    const fileName = process.platform === 'win32' ? 'C:\\path\\to\\file' : 'path/to/file'

    const downloader = new Downloader(observer)
    const pauseMock = jest.fn()
    DownloadManager.instance.networkRequests[fileName] = { pause: pauseMock }

    downloader.pauseDownload(observer, fileName)

    expect(pauseMock).toHaveBeenCalled()
  })

  it('should resume download correctly', () => {
    const observer = jest.fn()
    const fileName = process.platform === 'win32' ? 'C:\\path\\to\\file' : 'path/to/file'

    const downloader = new Downloader(observer)
    const resumeMock = jest.fn()
    DownloadManager.instance.networkRequests[fileName] = { resume: resumeMock }

    downloader.resumeDownload(observer, fileName)

    expect(resumeMock).toHaveBeenCalled()
  })

  it('should handle aborting a download correctly', () => {
    const observer = jest.fn()
    const fileName = process.platform === 'win32' ? 'C:\\path\\to\\file' : 'path/to/file'

    const downloader = new Downloader(observer)
    const abortMock = jest.fn()
    DownloadManager.instance.networkRequests[fileName] = { abort: abortMock }

    downloader.abortDownload(observer, fileName)

    expect(abortMock).toHaveBeenCalled()
    expect(observer).toHaveBeenCalledWith(
      DownloadEvent.onFileDownloadError,
      expect.objectContaining({
        error: 'aborted',
      })
    )
  })

  it('should handle download fail correctly', () => {
    const observer = jest.fn()
    const fileName = process.platform === 'win32' ? 'C:\\path\\to\\file' : 'path/to/file.gguf'

    const downloader = new Downloader(observer)

    downloader.downloadFile(observer, {
      localPath: fileName,
      url: 'http://127.0.0.1',
    })
    expect(observer).toHaveBeenCalledWith(
      DownloadEvent.onFileDownloadError,
      expect.objectContaining({
        error: expect.anything(),
      })
    )
  })
})
