import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HUGGINGFACE_TOKEN_SECRET_KEY,
  ServiceKeys,
  createServiceRegistry,
  type DownloadService,
  type InternalExtensionContext,
} from '@janhq/core'
import { activate } from './index'

type Progress = { transferred: number; total: number }
type Disposable = { dispose(): void }

// The parts of DisposableStore activate uses; disposing releases everything
// the extension registered.
function subscriptions() {
  const items: Disposable[] = []
  return {
    add: <T extends Disposable>(d: T) => (items.push(d), d),
    dispose: () => items.splice(0).forEach((d) => d.dispose()),
  }
}

function fakeContext(secrets: Record<string, string> = {}) {
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
  const downloads = {
    downloadFiles: vi.fn().mockResolvedValue(undefined),
    cancelDownload: vi.fn().mockResolvedValue(undefined),
    pauseDownload: vi.fn().mockResolvedValue(undefined),
    onDownloadProgress: vi.fn().mockResolvedValue(() => undefined),
  }
  const services = createServiceRegistry()
  const ctx = {
    extension: { id: 'jan.download', version: '1.0.0', displayName: 'D' },
    subscriptions: subscriptions(),
    log,
    internal: {
      services,
      downloads,
      secrets: { get: async (key: string) => secrets[key] ?? null },
    },
  } as unknown as InternalExtensionContext
  return { ctx, log, downloads, services }
}

async function activated(secrets: Record<string, string> = {}) {
  const fake = fakeContext(secrets)
  await activate(fake.ctx)
  const service = fake.services.get(ServiceKeys.Downloads) as DownloadService
  return { ...fake, service }
}

describe('download extension', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('activate', () => {
    it('provides the Downloads service until its subscriptions are disposed', async () => {
      const { ctx, services, service } = await activated()
      expect(service).toBeDefined()
      ctx.subscriptions.dispose()
      expect(services.get(ServiceKeys.Downloads)).toBeUndefined()
    })

    it('drops the settings the legacy extension kept in localStorage', async () => {
      localStorage.setItem('@janhq/download-extension', '[{"key":"hf-token"}]')
      localStorage.setItem('unrelated', 'kept')
      await activated()
      expect(localStorage.getItem('@janhq/download-extension')).toBeNull()
      expect(localStorage.getItem('unrelated')).toBe('kept')
    })
  })

  describe('downloadFiles', () => {
    it('sends the keyring Hugging Face token as a bearer Authorization header', async () => {
      const { service, downloads } = await activated({
        [HUGGINGFACE_TOKEN_SECRET_KEY]: 'hf_tok',
      })
      const items = [{ url: 'http://x/a.gguf', save_path: '/models/a.gguf' }]
      await service.downloadFiles(items, 'task-1')
      expect(downloads.onDownloadProgress).toHaveBeenCalledWith(
        'task-1',
        expect.any(Function)
      )
      expect(downloads.downloadFiles).toHaveBeenCalledWith(items, 'task-1', {
        Authorization: 'Bearer hf_tok',
      })
    })

    it('sends no Authorization header when the keyring has no token', async () => {
      const { service, downloads } = await activated()
      await service.downloadFiles([], 'task-2')
      expect(downloads.downloadFiles).toHaveBeenCalledWith([], 'task-2', {})
    })

    it('sends no Authorization header when the stored token is empty', async () => {
      const { service, downloads } = await activated({
        [HUGGINGFACE_TOKEN_SECRET_KEY]: '',
      })
      await service.downloadFiles([], 'task-3')
      expect(downloads.downloadFiles).toHaveBeenCalledWith([], 'task-3', {})
    })

    it('downloads without Authorization when the keyring cannot be read', async () => {
      const fake = fakeContext()
      const err = new Error('keyring locked')
      fake.ctx.internal.secrets.get = vi.fn().mockRejectedValue(err)
      await activate(fake.ctx)
      const service = fake.services.get(ServiceKeys.Downloads) as DownloadService
      await service.downloadFiles([], 'task-3b')
      expect(fake.downloads.downloadFiles).toHaveBeenCalledWith([], 'task-3b', {})
      expect(fake.log.warn).toHaveBeenCalledWith(
        'Could not read the Hugging Face token:',
        err
      )
    })

    it('reads the token at download time, so a changed token applies at once', async () => {
      const secrets: Record<string, string> = {}
      const { service, downloads } = await activated(secrets)
      secrets[HUGGINGFACE_TOKEN_SECRET_KEY] = 'hf_new'
      await service.downloadFiles([], 'task-4')
      expect(downloads.downloadFiles).toHaveBeenCalledWith([], 'task-4', {
        Authorization: 'Bearer hf_new',
      })
    })

    it('relays progress events into the onProgress callback', async () => {
      const { service, downloads } = await activated()
      let captured: ((p: Progress) => void) | undefined
      downloads.onDownloadProgress.mockImplementationOnce(
        async (_taskId: string, handler: (p: Progress) => void) => {
          captured = handler
          return () => undefined
        }
      )
      const onProgress = vi.fn()
      await service.downloadFiles([], 'task-5', onProgress)
      captured?.({ transferred: 30, total: 100 })
      expect(onProgress).toHaveBeenCalledWith(30, 100)
    })

    it('ignores progress events when no callback was given', async () => {
      const { service, downloads } = await activated()
      let captured: ((p: Progress) => void) | undefined
      downloads.onDownloadProgress.mockImplementationOnce(
        async (_taskId: string, handler: (p: Progress) => void) => {
          captured = handler
          return () => undefined
        }
      )
      await service.downloadFiles([], 'task-6')
      expect(() => captured?.({ transferred: 1, total: 2 })).not.toThrow()
    })

    it('unsubscribes from progress after a successful download', async () => {
      const { service, downloads } = await activated()
      const unsubscribe = vi.fn()
      downloads.onDownloadProgress.mockResolvedValueOnce(unsubscribe)
      await service.downloadFiles([], 'task-7')
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('logs, unsubscribes and rethrows when the download fails', async () => {
      const { service, downloads, log } = await activated()
      const unsubscribe = vi.fn()
      downloads.onDownloadProgress.mockResolvedValueOnce(unsubscribe)
      const err = new Error('network down')
      downloads.downloadFiles.mockRejectedValueOnce(err)
      await expect(service.downloadFiles([], 'task-8')).rejects.toThrow(
        'network down'
      )
      expect(log.error).toHaveBeenCalledWith(
        'Error downloading task',
        'task-8',
        err
      )
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })
  })

  describe('downloadFile', () => {
    it('downloads one item with its proxy config and relays progress', async () => {
      const { service, downloads } = await activated()
      let captured: ((p: Progress) => void) | undefined
      downloads.onDownloadProgress.mockImplementationOnce(
        async (_taskId: string, handler: (p: Progress) => void) => {
          captured = handler
          return () => undefined
        }
      )
      const onProgress = vi.fn()
      const proxy = { https: 'http://proxy:8080' }
      await service.downloadFile(
        'http://x/b.gguf',
        '/models/b.gguf',
        'task-9',
        proxy,
        onProgress
      )
      expect(downloads.downloadFiles).toHaveBeenCalledWith(
        [{ url: 'http://x/b.gguf', save_path: '/models/b.gguf', proxy }],
        'task-9',
        {}
      )
      captured?.({ transferred: 5, total: 10 })
      expect(onProgress).toHaveBeenCalledWith(5, 10)
    })

    it('defaults the proxy config to an empty object', async () => {
      const { service, downloads } = await activated()
      await service.downloadFile('http://x/c.gguf', '/models/c.gguf', 'task-10')
      expect(downloads.downloadFiles).toHaveBeenCalledWith(
        [{ url: 'http://x/c.gguf', save_path: '/models/c.gguf', proxy: {} }],
        'task-10',
        {}
      )
    })
  })

  describe('cancelDownload', () => {
    it('cancels the task through the host download API', async () => {
      const { service, downloads } = await activated()
      await service.cancelDownload('task-11')
      expect(downloads.cancelDownload).toHaveBeenCalledWith('task-11')
    })

    it('logs and rethrows on failure', async () => {
      const { service, downloads, log } = await activated()
      downloads.cancelDownload.mockRejectedValueOnce(new Error('cancel failed'))
      await expect(service.cancelDownload('task-11')).rejects.toThrow(
        'cancel failed'
      )
      expect(log.error).toHaveBeenCalled()
    })
  })

  describe('pauseDownload', () => {
    it('pauses the task through the host download API', async () => {
      const { service, downloads } = await activated()
      await service.pauseDownload('task-12')
      expect(downloads.pauseDownload).toHaveBeenCalledWith('task-12')
    })

    it('logs and rethrows on failure', async () => {
      const { service, downloads, log } = await activated()
      downloads.pauseDownload.mockRejectedValueOnce(new Error('pause failed'))
      await expect(service.pauseDownload('task-12')).rejects.toThrow(
        'pause failed'
      )
      expect(log.error).toHaveBeenCalled()
    })
  })
})

