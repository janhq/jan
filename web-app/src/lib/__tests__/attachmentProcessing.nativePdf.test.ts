import { describe, it, expect, vi } from 'vitest'
import { processAttachmentsForSend } from '../attachmentProcessing'
import type { Attachment } from '@/types/attachment'

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

const KEPT_PATH = 'D:/jan-data/attachments/01J/report.pdf'

const makeHub = () => {
  const uploads = {
    ingestImage: vi.fn(),
    ingestFileAttachment: vi.fn().mockResolvedValue({ id: 'doc-1', chunkCount: 3 }),
    ingestFileAttachmentForProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
    keepAttachmentFile: vi.fn().mockResolvedValue(KEPT_PATH),
  }
  const rag = { parseDocument: vi.fn().mockResolvedValue('parsed text') }
  return { hub: { uploads: () => uploads, rag: () => rag }, uploads, rag }
}

const pdf = (extra: Partial<Attachment> = {}): Attachment => ({
  name: 'report.pdf',
  type: 'document',
  path: 'C:/Users/me/report.pdf',
  fileType: 'pdf',
  ...extra,
})

const send = (
  hub: ReturnType<typeof makeHub>['hub'],
  attachments: Attachment[],
  extra: Record<string, unknown> = {}
) =>
  processAttachmentsForSend({
    attachments,
    threadId: 'thread-1',
    serviceHub: hub as never,
    parsePreference: 'auto',
    ...extra,
  })

// The Responses API reads a PDF itself, so the PDF goes to the model as it is:
// neither parsed into text nor indexed for retrieval.
describe('processAttachmentsForSend with a PDF for a Responses API model', () => {
  it.each(['azure', 'openai'])('keeps a copy and sends it as it is (%s)', async (provider) => {
    const { hub, uploads, rag } = makeHub()

    const result = await send(hub, [pdf()], { selectedProvider: provider })

    expect(uploads.keepAttachmentFile).toHaveBeenCalledWith(
      'C:/Users/me/report.pdf',
      'report.pdf'
    )
    expect(result.processedAttachments).toEqual([
      expect.objectContaining({
        name: 'report.pdf',
        path: KEPT_PATH,
        processed: true,
        processing: false,
        injectionMode: 'native',
      }),
    ])
    expect(result.hasEmbeddedDocuments).toBe(false)
    expect(rag.parseDocument).not.toHaveBeenCalled()
    expect(uploads.ingestFileAttachment).not.toHaveBeenCalled()
  })

  it('does it even when the user asked for retrieval or for inlining', async () => {
    const { hub, uploads } = makeHub()

    await send(hub, [pdf({ parseMode: 'embeddings' })], {
      selectedProvider: 'azure',
      parsePreference: 'inline',
    })

    expect(uploads.keepAttachmentFile).toHaveBeenCalled()
    expect(uploads.ingestFileAttachment).not.toHaveBeenCalled()
  })

  it('does not copy a PDF again once it has been sent', async () => {
    const { hub, uploads } = makeHub()
    const sent = pdf({ path: KEPT_PATH, processed: true, injectionMode: 'native' })

    const result = await send(hub, [sent], { selectedProvider: 'azure' })

    expect(uploads.keepAttachmentFile).not.toHaveBeenCalled()
    expect(result.processedAttachments).toEqual([sent])
    expect(result.hasEmbeddedDocuments).toBe(false)
  })

  it('reports a PDF that cannot be copied', async () => {
    const { hub, uploads } = makeHub()
    uploads.keepAttachmentFile.mockRejectedValue(new Error('disk full'))

    await expect(send(hub, [pdf()], { selectedProvider: 'azure' })).rejects.toThrow(
      'disk full'
    )
  })

  it('handles other documents as before', async () => {
    const { hub, uploads } = makeHub()

    await send(
      hub,
      [{ name: 'notes.docx', type: 'document', path: 'C:/notes.docx', fileType: 'docx' }],
      { selectedProvider: 'azure', parsePreference: 'embeddings' }
    )

    expect(uploads.keepAttachmentFile).not.toHaveBeenCalled()
    expect(uploads.ingestFileAttachment).toHaveBeenCalled()
  })

  it('handles PDFs for other providers as before', async () => {
    const { hub, uploads } = makeHub()

    await send(hub, [pdf()], { selectedProvider: 'llamacpp', parsePreference: 'embeddings' })

    expect(uploads.keepAttachmentFile).not.toHaveBeenCalled()
    expect(uploads.ingestFileAttachment).toHaveBeenCalled()
  })

  // Project files are shared by every thread of the project, whichever model
  // each thread uses, so they stay indexed for retrieval.
  it('keeps indexing project files', async () => {
    const { hub, uploads } = makeHub()

    await send(hub, [pdf()], { selectedProvider: 'azure', projectId: 'project-1' })

    expect(uploads.keepAttachmentFile).not.toHaveBeenCalled()
    expect(uploads.ingestFileAttachmentForProject).toHaveBeenCalled()
  })
})
