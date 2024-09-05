import { HttpServer } from '../../HttpServer'
import { DownloadManager } from '../../../helper/download'

describe('downloadRouter', () => {
  let app: HttpServer

  beforeEach(() => {
    app = {
      register: jest.fn(),
      post: jest.fn(),
      get: jest.fn(),
      patch: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    }
  })

  it('should return download progress for a given modelId', async () => {
    const modelId = '123'
    const downloadProgress = { progress: 50 }

    DownloadManager.instance.downloadProgressMap[modelId] = downloadProgress as any

    const req = { params: { modelId } }
    const res = {
      status: jest.fn(),
      send: jest.fn(),
    }

    jest.spyOn(app, 'get').mockImplementation((path, handler) => {
      if (path === `/download/getDownloadProgress/${modelId}`) {
        res.status(200)
        res.send(downloadProgress)
      }
    })

    app.get(`/download/getDownloadProgress/${modelId}`, req as any)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.send).toHaveBeenCalledWith(downloadProgress)
  })

  it('should return 404 if download progress is not found', async () => {
    const modelId = '123'

    const req = { params: { modelId } }
    const res = {
      status: jest.fn(),
      send: jest.fn(),
    }


    jest.spyOn(app, 'get').mockImplementation((path, handler) => {
      if (path === `/download/getDownloadProgress/${modelId}`) {
        res.status(404)
        res.send({ message: 'Download progress not found' })
      }
    })
    app.get(`/download/getDownloadProgress/${modelId}`, req as any)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.send).toHaveBeenCalledWith({ message: 'Download progress not found' })
  })
})
