import { describe, it, expect, vi } from 'vitest'
import { processAttachmentsForSend } from '../attachmentProcessing'

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

const createMockServiceHub = (overrides: Record<string, any> = {}) => ({
  uploads: () => ({
    ingestImage: vi.fn().mockResolvedValue({ id: 'img-1', size: 100 }),
    ingestFileAttachment: vi.fn().mockResolvedValue({ id: 'doc-1', size: 500, chunkCount: 3 }),
    ingestFileAttachmentForProject: vi.fn().mockResolvedValue({ id: 'proj-1', size: 500, chunkCount: 5 }),
    ...overrides,
  }),
  rag: () => ({
    parseDocument: vi.fn().mockResolvedValue('parsed text'),
  }),
})

describe('processAttachmentsForSend - additional coverage', () => {
  const threadId = 'thread-1'

  it('throws on image ingest failure', async () => {
    const hub = {
      ...createMockServiceHub(),
      uploads: () => ({
        ingestImage: vi.fn().mockRejectedValue(new Error('upload failed')),
        ingestFileAttachment: vi.fn(),
        ingestFileAttachmentForProject: vi.fn(),
      }),
    }
    await expect(
      processAttachmentsForSend({
        attachments: [{ name: 'img.jpg', type: 'image' as const }],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
      })
    ).rejects.toThrow('upload failed')
  })

  it('throws on document ingest failure', async () => {
    const hub = {
      uploads: () => ({
        ingestImage: vi.fn(),
        ingestFileAttachment: vi.fn().mockRejectedValue('string error'),
        ingestFileAttachmentForProject: vi.fn(),
      }),
      rag: () => ({ parseDocument: vi.fn().mockResolvedValue(undefined) }),
    }
    await expect(
      processAttachmentsForSend({
        attachments: [{ name: 'doc.pdf', type: 'document' as const, path: '/doc.pdf' }],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'embeddings',
      })
    ).rejects.toThrow('string error')
  })

  it('auto mode with token estimation falls back to embeddings when over threshold', async () => {
    const hub = createMockServiceHub()
    const result = await processAttachmentsForSend({
      attachments: [{ name: 'big.txt', type: 'document' as const, path: '/big.txt' }],
      threadId,
      serviceHub: hub as any,
      parsePreference: 'auto',
      contextThreshold: 100,
      estimateTokens: vi.fn().mockResolvedValue(200),
    })
    expect(result.processedAttachments[0].injectionMode).toBe('embeddings')
  })

  it('auto mode with token estimation uses inline when under threshold', async () => {
    const hub = createMockServiceHub()
    const result = await processAttachmentsForSend({
      attachments: [{ name: 'small.txt', type: 'document' as const, path: '/small.txt' }],
      threadId,
      serviceHub: hub as any,
      parsePreference: 'auto',
      contextThreshold: 500,
      estimateTokens: vi.fn().mockResolvedValue(50),
    })
    expect(result.processedAttachments[0].injectionMode).toBe('inline')
  })

  it('auto mode without estimateTokens defaults to autoFallbackMode', async () => {
    const hub = createMockServiceHub()
    const result = await processAttachmentsForSend({
      attachments: [{ name: 'doc.txt', type: 'document' as const, path: '/doc.txt' }],
      threadId,
      serviceHub: hub as any,
      parsePreference: 'auto',
      autoFallbackMode: 'inline',
    })
    // Without estimateTokens, uses autoFallbackMode
    expect(result.processedAttachments[0].injectionMode).toBe('inline')
  })

  it('prompt mode uses perFileChoices', async () => {
    const hub = createMockServiceHub()
    const choices = new Map([[ '/doc.txt', 'inline' as const ]])
    const result = await processAttachmentsForSend({
      attachments: [{ name: 'doc.txt', type: 'document' as const, path: '/doc.txt' }],
      threadId,
      serviceHub: hub as any,
      parsePreference: 'prompt',
      perFileChoices: choices,
    })
    expect(result.processedAttachments[0].injectionMode).toBe('inline')
  })

  it('prompt mode defaults to autoFallbackMode when no perFileChoice', async () => {
    const hub = createMockServiceHub()
    const result = await processAttachmentsForSend({
      attachments: [{ name: 'doc.txt', type: 'document' as const, path: '/doc.txt' }],
      threadId,
      serviceHub: hub as any,
      parsePreference: 'prompt',
      autoFallbackMode: 'inline',
    })
    expect(result.processedAttachments[0].injectionMode).toBe('inline')
  })

  it('skips already-processed inline documents', async () => {
    const hub = createMockServiceHub()
    const result = await processAttachmentsForSend({
      attachments: [
        { name: 'doc.txt', type: 'document' as const, processed: true, injectionMode: 'inline' as const },
      ],
      threadId,
      serviceHub: hub as any,
      parsePreference: 'auto',
    })
    expect(result.processedAttachments).toHaveLength(1)
    expect(result.hasEmbeddedDocuments).toBe(false)
  })

  it('handles non-finite contextThreshold', async () => {
    const hub = createMockServiceHub()
    const result = await processAttachmentsForSend({
      attachments: [{ name: 'doc.txt', type: 'document' as const, path: '/doc.txt' }],
      threadId,
      serviceHub: hub as any,
      parsePreference: 'auto',
      contextThreshold: NaN,
      estimateTokens: vi.fn().mockResolvedValue(50),
    })
    // NaN threshold means no threshold -> defaults to embeddings
    expect(result.processedAttachments[0].injectionMode).toBe('embeddings')
  })

  it('handles non-positive token estimate', async () => {
    const hub = createMockServiceHub()
    const result = await processAttachmentsForSend({
      attachments: [{ name: 'doc.txt', type: 'document' as const, path: '/doc.txt' }],
      threadId,
      serviceHub: hub as any,
      parsePreference: 'auto',
      contextThreshold: 500,
      estimateTokens: vi.fn().mockResolvedValue(-1),
    })
    // Non-positive estimate -> defaults to embeddings
    expect(result.processedAttachments[0].injectionMode).toBe('embeddings')
  })

  it('handles error as array', async () => {
    const hub = {
      uploads: () => ({
        ingestImage: vi.fn().mockRejectedValue(['err1', 'err2']),
        ingestFileAttachment: vi.fn(),
        ingestFileAttachmentForProject: vi.fn(),
      }),
      rag: () => ({ parseDocument: vi.fn() }),
    }
    await expect(
      processAttachmentsForSend({
        attachments: [{ name: 'img.jpg', type: 'image' as const }],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
      })
    ).rejects.toThrow('err1; err2')
  })

  it('handles error as object with message', async () => {
    const hub = {
      uploads: () => ({
        ingestImage: vi.fn().mockRejectedValue({ message: 'obj error' }),
        ingestFileAttachment: vi.fn(),
        ingestFileAttachmentForProject: vi.fn(),
      }),
      rag: () => ({ parseDocument: vi.fn() }),
    }
    await expect(
      processAttachmentsForSend({
        attachments: [{ name: 'img.jpg', type: 'image' as const }],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
      })
    ).rejects.toThrow('obj error')
  })

  it('handles error as object with nested error', async () => {
    const hub = {
      uploads: () => ({
        ingestImage: vi.fn().mockRejectedValue({ error: { message: 'nested' } }),
        ingestFileAttachment: vi.fn(),
        ingestFileAttachmentForProject: vi.fn(),
      }),
      rag: () => ({ parseDocument: vi.fn() }),
    }
    await expect(
      processAttachmentsForSend({
        attachments: [{ name: 'img.jpg', type: 'image' as const }],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
      })
    ).rejects.toThrow('nested')
  })

  it('handles error as object with code only', async () => {
    const hub = {
      uploads: () => ({
        ingestImage: vi.fn().mockRejectedValue({ code: 'ERR_TIMEOUT' }),
        ingestFileAttachment: vi.fn(),
        ingestFileAttachmentForProject: vi.fn(),
      }),
      rag: () => ({ parseDocument: vi.fn() }),
    }
    await expect(
      processAttachmentsForSend({
        attachments: [{ name: 'img.jpg', type: 'image' as const }],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
      })
    ).rejects.toThrow('ERR_TIMEOUT')
  })

  it('handles null/falsy error', async () => {
    const hub = {
      uploads: () => ({
        ingestImage: vi.fn().mockRejectedValue(null),
        ingestFileAttachment: vi.fn(),
        ingestFileAttachmentForProject: vi.fn(),
      }),
      rag: () => ({ parseDocument: vi.fn() }),
    }
    await expect(
      processAttachmentsForSend({
        attachments: [{ name: 'img.jpg', type: 'image' as const }],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
      })
    ).rejects.toThrow('Unknown error')
  })

  it('handles error object with cause string', async () => {
    const hub = {
      uploads: () => ({
        ingestImage: vi.fn().mockRejectedValue({ cause: 'cause string' }),
        ingestFileAttachment: vi.fn(),
        ingestFileAttachmentForProject: vi.fn(),
      }),
      rag: () => ({ parseDocument: vi.fn() }),
    }
    await expect(
      processAttachmentsForSend({
        attachments: [{ name: 'img.jpg', type: 'image' as const }],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
      })
    ).rejects.toThrow('cause string')
  })

  it('auto mode: no parsedContent available logs debug and defaults', async () => {
    const hub = {
      uploads: () => ({
        ingestImage: vi.fn(),
        ingestFileAttachment: vi.fn().mockResolvedValue({ id: 'd1', size: 10, chunkCount: 1 }),
        ingestFileAttachmentForProject: vi.fn(),
      }),
      rag: () => ({ parseDocument: vi.fn().mockRejectedValue(new Error('fail')) }),
    }
    const result = await processAttachmentsForSend({
      attachments: [{ name: 'doc.txt', type: 'document' as const, path: '/doc.txt' }],
      threadId,
      serviceHub: hub as any,
      parsePreference: 'auto',
      estimateTokens: vi.fn().mockResolvedValue(50),
    })
    expect(result.processedAttachments[0].injectionMode).toBe('embeddings')
  })
})
