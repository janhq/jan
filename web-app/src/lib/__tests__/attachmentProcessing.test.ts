import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  needsIngestionChoice,
  processAttachmentsForSend,
  resolveAutoInlineBudget,
  type AttachmentProcessingResult,
} from '../attachmentProcessing'
import type { Attachment } from '@/types/attachment'

// Minimal mock for ServiceHub methods used by processAttachmentsForSend
const createMockServiceHub = (overrides: Record<string, unknown> = {}) => ({
  uploads: () => ({
    ingestImage: vi
      .fn()
      .mockResolvedValue({ id: 'img-1', size: 100 }),
    ingestFileAttachment: vi
      .fn()
      .mockResolvedValue({ id: 'doc-1', size: 500, chunkCount: 3 }),
    ingestFileAttachmentForProject: vi
      .fn()
      .mockResolvedValue({ id: 'proj-doc-1', size: 500, chunkCount: 5 }),
    ...overrides,
  }),
  rag: () => ({
    parseDocument: vi.fn().mockResolvedValue('parsed document text'),
  }),
})

const getModelPropsMock = vi.fn()
let propsExtensionAvailable = true
vi.mock('@/lib/llamacppRouterProps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llamacppRouterProps')>()),
  getLocalPropsExtension: (provider: string) =>
    propsExtensionAvailable &&
    (provider === 'llamacpp' || provider === 'mlx')
      ? { getModelProps: getModelPropsMock }
      : undefined,
}))

const modelWithCtx = (value: string | number): Model => ({
  id: 'm1',
  settings: {
    ctx_len: {
      key: 'ctx_len',
      title: 'Context Size',
      description: '',
      controller_type: 'input',
      controller_props: { value },
    },
  },
})

const docAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  name: 'report.pdf',
  type: 'document',
  path: '/tmp/report.pdf',
  fileType: 'pdf',
  ...overrides,
})

const imageAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  name: 'photo.jpg',
  type: 'image',
  base64: 'abc123',
  mimeType: 'image/jpeg',
  ...overrides,
})

describe('processAttachmentsForSend', () => {
  const threadId = 'thread-1'

  describe('images', () => {
    it('ingests unprocessed images and returns them with id', async () => {
      const hub = createMockServiceHub()
      const img = imageAttachment()

      const result = await processAttachmentsForSend({
        attachments: [img],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
      })

      expect(result.processedAttachments).toHaveLength(1)
      expect(result.processedAttachments[0].id).toBe('img-1')
      expect(result.processedAttachments[0].processed).toBe(true)
    })

    it('skips already-processed images', async () => {
      const hub = createMockServiceHub()
      const img = imageAttachment({ processed: true, id: 'existing-id' })

      const result = await processAttachmentsForSend({
        attachments: [img],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
      })

      expect(result.processedAttachments[0].id).toBe('existing-id')
      expect(hub.uploads().ingestImage).not.toHaveBeenCalled()
    })
  })

  describe('documents — parseMode routing', () => {
    it('uses inline mode when parseMode is "inline"', async () => {
      const hub = createMockServiceHub()
      const doc = docAttachment({ parseMode: 'inline' })

      const result = await processAttachmentsForSend({
        attachments: [doc],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
      })

      expect(result.processedAttachments[0].injectionMode).toBe('inline')
      expect(result.processedAttachments[0].inlineContent).toBe(
        'parsed document text'
      )
      expect(result.hasEmbeddedDocuments).toBe(false)
    })

    it('uses embeddings mode when parseMode is "embeddings"', async () => {
      const hub = createMockServiceHub()
      const doc = docAttachment({ parseMode: 'embeddings' })

      const result = await processAttachmentsForSend({
        attachments: [doc],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
      })

      expect(result.processedAttachments[0].injectionMode).toBe('embeddings')
      expect(result.processedAttachments[0].id).toBe('doc-1')
      expect(result.hasEmbeddedDocuments).toBe(true)
    })

    it('falls back to embeddings when inline parsing fails', async () => {
      const failingParse = vi.fn().mockRejectedValue(new Error('parse failed'))
      const hub = {
        ...createMockServiceHub(),
        rag: () => ({ parseDocument: failingParse }),
      }
      const doc = docAttachment({ parseMode: 'inline' })

      const result = await processAttachmentsForSend({
        attachments: [doc],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
      })

      // Falls back to embeddings since parsedContent is absent
      expect(result.processedAttachments[0].injectionMode).toBe('embeddings')
      expect(result.hasEmbeddedDocuments).toBe(true)
    })

    it('skips already-processed documents', async () => {
      const hub = createMockServiceHub()
      const doc = docAttachment({
        processed: true,
        id: 'existing-doc',
        injectionMode: 'embeddings',
      })

      const result = await processAttachmentsForSend({
        attachments: [doc],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
      })

      expect(result.processedAttachments[0].id).toBe('existing-doc')
      expect(hub.uploads().ingestFileAttachment).not.toHaveBeenCalled()
    })

    it('forces embeddings for project files', async () => {
      const hub = createMockServiceHub()
      const doc = docAttachment({ parseMode: 'inline' })

      const result = await processAttachmentsForSend({
        attachments: [doc],
        threadId,
        projectId: 'proj-1',
        serviceHub: hub as any,
        parsePreference: 'auto',
      })

      expect(result.processedAttachments[0].injectionMode).toBe('embeddings')
      expect(result.processedAttachments[0].id).toBe('proj-doc-1')
    })
  })

  describe('callbacks', () => {
    it('calls updateAttachmentProcessing for each document', async () => {
      const hub = createMockServiceHub()
      const doc = docAttachment({ parseMode: 'embeddings' })
      const updateFn = vi.fn()

      await processAttachmentsForSend({
        attachments: [doc],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
        updateAttachmentProcessing: updateFn,
      })

      // Called with 'processing' then 'done'
      expect(updateFn).toHaveBeenCalledWith('report.pdf', 'processing')
      expect(updateFn).toHaveBeenCalledWith(
        'report.pdf',
        'done',
        expect.objectContaining({ processed: true, injectionMode: 'embeddings' })
      )
    })

    it('fires onIngestProgress for multi-file uploads', async () => {
      const hub = createMockServiceHub()
      const docs = [
        docAttachment({ name: 'a.pdf', path: '/a.pdf', parseMode: 'embeddings' }),
        docAttachment({ name: 'b.pdf', path: '/b.pdf', parseMode: 'embeddings' }),
      ]
      const progressFn = vi.fn()

      await processAttachmentsForSend({
        attachments: docs,
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
        onIngestProgress: progressFn,
      })

      // Initial: {completed: 0, total: 2}, then increments
      expect(progressFn).toHaveBeenCalledWith({ completed: 0, total: 2 })
      expect(progressFn).toHaveBeenCalledWith({ completed: 1, total: 2 })
      expect(progressFn).toHaveBeenCalledWith({ completed: 2, total: 2 })
    })
  })

  describe('mixed attachments', () => {
    it('processes images and documents together', async () => {
      const hub = createMockServiceHub()
      const img = imageAttachment()
      const doc = docAttachment({ parseMode: 'embeddings' })

      const result = await processAttachmentsForSend({
        attachments: [img, doc],
        threadId,
        serviceHub: hub as any,
        parsePreference: 'auto',
      })

      expect(result.processedAttachments).toHaveLength(2)
      expect(result.processedAttachments[0].type).toBe('image')
      expect(result.processedAttachments[1].type).toBe('document')
      expect(result.hasEmbeddedDocuments).toBe(true)
    })
  })

  describe('resolveAutoInlineBudget', () => {
    beforeEach(() => {
      getModelPropsMock.mockReset()
      propsExtensionAvailable = true
    })

    it('scales the configured ctx_len by the ratio', async () => {
      await expect(
        resolveAutoInlineBudget(modelWithCtx(8192), 'llamacpp', 0.75)
      ).resolves.toBe(6144)
      await expect(
        resolveAutoInlineBudget(modelWithCtx('16384'), 'llamacpp', 0.5)
      ).resolves.toBe(8192)
      expect(getModelPropsMock).not.toHaveBeenCalled()
    })

    it('falls back to the launched window when ctx_len is left to auto-fit', async () => {
      getModelPropsMock.mockResolvedValue({ nCtx: 4096 })
      await expect(
        resolveAutoInlineBudget(modelWithCtx(''), 'llamacpp', 0.75)
      ).resolves.toBe(3072)
      expect(getModelPropsMock).toHaveBeenCalledWith('m1')
    })

    it('is undefined when the local model is not loaded yet', async () => {
      getModelPropsMock.mockRejectedValue(new Error('not loaded'))
      await expect(
        resolveAutoInlineBudget(modelWithCtx(''), 'llamacpp', 0.75)
      ).resolves.toBeUndefined()
    })

    it('is undefined for cloud models, which report no context window', async () => {
      await expect(
        resolveAutoInlineBudget({ id: 'gpt' }, 'openai', 0.75)
      ).resolves.toBeUndefined()
    })

    it('is undefined without a model or with a non-positive ratio', async () => {
      await expect(
        resolveAutoInlineBudget(undefined, 'llamacpp', 0.75)
      ).resolves.toBeUndefined()
      await expect(
        resolveAutoInlineBudget(modelWithCtx(8192), 'llamacpp', 0)
      ).resolves.toBeUndefined()
    })
  })

  describe('needsIngestionChoice', () => {
    it('asks in prompt mode regardless of the budget', () => {
      expect(needsIngestionChoice(docAttachment(), 'prompt', true)).toBe(true)
    })

    it('decides auto mode by size when a budget is known', () => {
      expect(needsIngestionChoice(docAttachment(), 'auto', true)).toBe(false)
    })

    it('asks in auto mode only when no budget is known', () => {
      expect(needsIngestionChoice(docAttachment(), 'auto', false)).toBe(true)
    })

    it('never asks for explicit modes or already-routed documents', () => {
      expect(needsIngestionChoice(docAttachment(), 'inline', false)).toBe(false)
      expect(
        needsIngestionChoice(docAttachment({ parseMode: 'embeddings' }), 'prompt', false)
      ).toBe(false)
      expect(
        needsIngestionChoice(docAttachment({ injectionMode: 'inline' }), 'prompt', false)
      ).toBe(false)
    })
  })
})
