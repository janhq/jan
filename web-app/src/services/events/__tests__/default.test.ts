import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultEventsService } from '../default'

describe('DefaultEventsService', () => {
  let svc: DefaultEventsService

  beforeEach(() => {
    svc = new DefaultEventsService()
    vi.restoreAllMocks()
  })

  describe('emit', () => {
    it('resolves without error (no payload)', async () => {
      await expect(svc.emit('test-event')).resolves.toBeUndefined()
    })

    it('resolves without error (with payload)', async () => {
      await expect(svc.emit('test-event', { data: 123 })).resolves.toBeUndefined()
    })

    it('resolves without error (with options)', async () => {
      await expect(
        svc.emit('test-event', { data: 123 }, { target: 'window' } as any)
      ).resolves.toBeUndefined()
    })
  })

  describe('listen', () => {
    it('returns an unlisten function', async () => {
      const handler = vi.fn()
      const unlisten = await svc.listen('test-event', handler)
      expect(typeof unlisten).toBe('function')
    })

    it('unlisten function is a no-op', async () => {
      const handler = vi.fn()
      const unlisten = await svc.listen('test-event', handler)
      expect(() => unlisten()).not.toThrow()
    })

    it('accepts options parameter', async () => {
      const handler = vi.fn()
      const unlisten = await svc.listen('test-event', handler, { target: 'window' } as any)
      expect(typeof unlisten).toBe('function')
    })
  })
})
