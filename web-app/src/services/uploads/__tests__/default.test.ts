import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(),
  },
}))

vi.mock('ulidx', () => ({
  ulid: vi.fn(() => 'mock-ulid-123'),
}))

import { ExtensionManager } from '@/lib/extension'
import { DefaultUploadsService } from '../default'
import type { Attachment } from '@/types/attachment'

const mockGet = vi.fn()

beforeEach(() => {
  vi.mocked(ExtensionManager.getInstance).mockReturnValue({ get: mockGet } as any)
  mockGet.mockReset()
  vi.useFakeTimers()
})

const imageAttachment: Attachment = { type: 'image', name: 'img.png', path: '/img.png', size: 100, fileType: 'png' } as any
const docAttachment: Attachment = { type: 'document', name: 'doc.pdf', path: '/doc.pdf', size: 200, fileType: 'pdf' } as any

describe('DefaultUploadsService.ingestImage', () => {
  it('returns an id for image attachments', async () => {
    const svc = new DefaultUploadsService()
    const promise = svc.ingestImage('t1', imageAttachment)
    vi.advanceTimersByTime(200)
    const res = await promise
    expect(res.id).toBe('mock-ulid-123')
  })

  it('throws for non-image attachments', async () => {
    const svc = new DefaultUploadsService()
    await expect(svc.ingestImage('t1', docAttachment)).rejects.toThrow('not image')
  })
})

describe('DefaultUploadsService.ingestFileAttachment', () => {
  it('returns upload result on success', async () => {
    vi.useRealTimers()
    const ingestAttachments = vi.fn().mockResolvedValue({
      files: [{ id: 'file-1', size: 500, chunk_count: 3 }],
    })
    mockGet.mockReturnValue({ ingestAttachments })
    const svc = new DefaultUploadsService()
    const res = await svc.ingestFileAttachment('t1', docAttachment)
    expect(res).toEqual({ id: 'file-1', size: 500, chunkCount: 3 })
  })

  it('throws for non-document attachments', async () => {
    vi.useRealTimers()
    const svc = new DefaultUploadsService()
    await expect(svc.ingestFileAttachment('t1', imageAttachment)).rejects.toThrow('not document')
  })

  it('throws when RAG extension not available', async () => {
    vi.useRealTimers()
    mockGet.mockReturnValue(undefined)
    const svc = new DefaultUploadsService()
    await expect(svc.ingestFileAttachment('t1', docAttachment)).rejects.toThrow('RAG extension not available')
  })

  it('throws when no id returned', async () => {
    vi.useRealTimers()
    mockGet.mockReturnValue({ ingestAttachments: vi.fn().mockResolvedValue({ files: [] }) })
    const svc = new DefaultUploadsService()
    await expect(svc.ingestFileAttachment('t1', docAttachment)).rejects.toThrow('Failed to resolve')
  })

  it('handles non-number size/chunk_count', async () => {
    vi.useRealTimers()
    mockGet.mockReturnValue({
      ingestAttachments: vi.fn().mockResolvedValue({
        files: [{ id: 'f1', size: 'big', chunk_count: 'many' }],
      }),
    })
    const svc = new DefaultUploadsService()
    const res = await svc.ingestFileAttachment('t1', docAttachment)
    expect(res).toEqual({ id: 'f1', size: undefined, chunkCount: undefined })
  })
})

describe('DefaultUploadsService.ingestFileAttachmentForProject', () => {
  it('returns upload result on success', async () => {
    vi.useRealTimers()
    const ingestAttachmentsForProject = vi.fn().mockResolvedValue({
      files: [{ id: 'pf-1', size: 800, chunk_count: 5 }],
    })
    mockGet.mockReturnValue({ ingestAttachmentsForProject })
    const svc = new DefaultUploadsService()
    const res = await svc.ingestFileAttachmentForProject('p1', docAttachment)
    expect(res).toEqual({ id: 'pf-1', size: 800, chunkCount: 5 })
  })

  it('throws for non-document attachments', async () => {
    vi.useRealTimers()
    const svc = new DefaultUploadsService()
    await expect(svc.ingestFileAttachmentForProject('p1', imageAttachment)).rejects.toThrow('not document')
  })

  it('throws when ext lacks ingestAttachmentsForProject', async () => {
    vi.useRealTimers()
    mockGet.mockReturnValue({})
    const svc = new DefaultUploadsService()
    await expect(svc.ingestFileAttachmentForProject('p1', docAttachment)).rejects.toThrow('does not support')
  })

  it('throws when no id returned', async () => {
    vi.useRealTimers()
    mockGet.mockReturnValue({ ingestAttachmentsForProject: vi.fn().mockResolvedValue({ files: [{}] }) })
    const svc = new DefaultUploadsService()
    await expect(svc.ingestFileAttachmentForProject('p1', docAttachment)).rejects.toThrow('Failed to resolve')
  })

  it('handles non-number size/chunk_count', async () => {
    vi.useRealTimers()
    mockGet.mockReturnValue({
      ingestAttachmentsForProject: vi.fn().mockResolvedValue({
        files: [{ id: 'f1', size: 'x', chunk_count: 'y' }],
      }),
    })
    const svc = new DefaultUploadsService()
    const res = await svc.ingestFileAttachmentForProject('p1', docAttachment)
    expect(res).toEqual({ id: 'f1', size: undefined, chunkCount: undefined })
  })
})
