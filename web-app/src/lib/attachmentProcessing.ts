import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { ServiceHub } from '@/services'
import { Attachment } from '@/types/attachment'
import { toast } from 'sonner'

type AttachmentProcessingStatus =
  | 'processing'
  | 'done'
  | 'error'
  | 'clear_docs'
  | 'clear_all'

type AttachmentProcessingOptions = {
  attachments: Attachment[]
  threadId: string
  serviceHub: ServiceHub
  selectedProvider?: string
  contextThreshold?: number
  estimateTokens?: (text: string) => Promise<number | undefined>
  parsePreference: 'auto' | 'inline' | 'embeddings' | 'prompt'
  autoFallbackMode?: 'inline' | 'embeddings'
  updateAttachmentProcessing?: (name: string, status: AttachmentProcessingStatus) => void
}

export type AttachmentProcessingResult = {
  processedAttachments: Attachment[]
  hasEmbeddedDocuments: boolean
}

export const processAttachmentsForSend = async (
  options: AttachmentProcessingOptions
): Promise<AttachmentProcessingResult> => {
  const {
    attachments,
    threadId,
    serviceHub,
    contextThreshold,
    estimateTokens,
    parsePreference,
    autoFallbackMode,
    updateAttachmentProcessing,
  } = options

  const fileAttachmentsFeatureEnabled = PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS]
  const processedAttachments: Attachment[] = []
  let hasEmbeddedDocuments = false

  // Images: ingest before sending
  const images = attachments.filter((a) => a.type === 'image')
  if (images.length > 0) {
    for (const img of images) {
      try {
        if (img.processed && img.id) {
          processedAttachments.push(img)
          continue
        }

        if (updateAttachmentProcessing) {
          updateAttachmentProcessing(img.name, 'processing')
        }

        const res = await serviceHub.uploads().ingestImage(threadId, img)
        processedAttachments.push({
          ...img,
          id: res.id,
          processed: true,
          processing: false,
        })
        if (updateAttachmentProcessing) {
          updateAttachmentProcessing(img.name, 'done')
        }
      } catch (err) {
        console.error(`Failed to ingest image ${img.name}:`, err)
        if (updateAttachmentProcessing) {
          updateAttachmentProcessing(img.name, 'error')
        }
        const desc = err instanceof Error ? err.message : String(err)
        toast.error('Failed to ingest image attachment', { description: desc })
        throw err
      }
    }
  }

  if (fileAttachmentsFeatureEnabled) {
    const documents = attachments.filter((a) => a.type === 'document')
    for (const doc of documents) {
      try {
        if (doc.processed && (doc.id || doc.injectionMode === 'inline')) {
          hasEmbeddedDocuments = hasEmbeddedDocuments || doc.injectionMode !== 'inline'
          processedAttachments.push(doc)
          continue
        }

        if (updateAttachmentProcessing) {
          updateAttachmentProcessing(doc.name, 'processing')
        }

        const targetPreference = doc.parseMode ?? parsePreference
        let targetMode: 'inline' | 'embeddings' =
          targetPreference === 'inline' ? 'inline' : 'embeddings'
        let parsedContent: string | undefined

        const canInline =
          targetPreference !== 'embeddings' && !!doc.path

        if (canInline) {
          try {
            parsedContent = await serviceHub.rag().parseDocument?.(doc.path!, doc.fileType)
          } catch (err) {
            console.warn(`Failed to parse ${doc.name} for inline use`, err)
          }
        }

        if (targetPreference === 'auto') {
          targetMode = autoFallbackMode ?? 'embeddings'
          if (parsedContent && estimateTokens) {
            const tokenCount = await estimateTokens(parsedContent)
            if (!contextThreshold) {
              console.debug(
                `Attachment ${doc.name}: no context threshold available; defaulting to ${targetMode}`
              )
            } else if (typeof tokenCount === 'number') {
              targetMode = tokenCount <= contextThreshold ? 'inline' : 'embeddings'
            } else {
              console.debug(
                `Attachment ${doc.name}: token estimate missing; defaulting to ${targetMode}`
              )
            }
          } else if (!parsedContent) {
            console.debug(
              `Attachment ${doc.name}: parsed content unavailable for token estimation; defaulting to ${targetMode}`
            )
          } else {
            console.debug(
              `Attachment ${doc.name}: token estimator unavailable; defaulting to ${targetMode}`
            )
          }
        } else if (targetPreference === 'prompt') {
          targetMode = autoFallbackMode ?? 'embeddings'
        }

        if (targetMode === 'inline' && parsedContent) {
          processedAttachments.push({
            ...doc,
            processing: false,
            processed: true,
            inlineContent: parsedContent,
            injectionMode: 'inline',
          })

          if (updateAttachmentProcessing) {
            updateAttachmentProcessing(doc.name, 'done')
          }
          continue
        }

        // Default: ingest as embeddings
        if (updateAttachmentProcessing) {
          updateAttachmentProcessing(doc.name, 'processing')
        }

        const res = await serviceHub
          .uploads()
          .ingestFileAttachment(threadId, doc)

        processedAttachments.push({
          ...doc,
          id: res.id,
          size: res.size ?? doc.size,
          chunkCount: res.chunkCount ?? doc.chunkCount,
          processing: false,
          processed: true,
          injectionMode: 'embeddings',
        })
        hasEmbeddedDocuments = true

        if (updateAttachmentProcessing) {
          updateAttachmentProcessing(doc.name, 'done')
        }
      } catch (err) {
        console.error(`Failed to ingest ${doc.name}:`, err)
        if (updateAttachmentProcessing) {
          updateAttachmentProcessing(doc.name, 'error')
        }
        const desc = err instanceof Error ? err.message : String(err)
        toast.error('Failed to index attachments', { description: desc })
        throw err
      }
    }
  }

  return { processedAttachments, hasEmbeddedDocuments }
}
