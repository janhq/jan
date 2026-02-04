<<<<<<< HEAD
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
import { ServiceHub } from '@/services'
import { Attachment } from '@/types/attachment'
import { toast } from 'sonner'

<<<<<<< HEAD
type AttachmentProcessingStatus =
  | 'processing'
  | 'done'
  | 'error'
  | 'clear_all'
=======
type AttachmentProcessingStatus = 'processing' | 'done' | 'error' | 'clear_all'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

type AttachmentProcessingOptions = {
  attachments: Attachment[]
  threadId: string
<<<<<<< HEAD
=======
  projectId?: string
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  serviceHub: ServiceHub
  selectedProvider?: string
  contextThreshold?: number
  estimateTokens?: (text: string) => Promise<number | undefined>
  parsePreference: 'auto' | 'inline' | 'embeddings' | 'prompt'
  autoFallbackMode?: 'inline' | 'embeddings'
  perFileChoices?: Map<string, 'inline' | 'embeddings'>
  updateAttachmentProcessing?: (
    name: string,
    status: AttachmentProcessingStatus,
    updatedAttachment?: Partial<Attachment>
  ) => void
}

export type AttachmentProcessingResult = {
  processedAttachments: Attachment[]
  hasEmbeddedDocuments: boolean
}

const formatAttachmentError = (err: unknown): string => {
  if (!err) return 'Unknown error'
  if (err instanceof Error) return err.message || err.toString()
  if (typeof err === 'string') return err
  if (Array.isArray(err)) {
    const parts = err.map((e) => formatAttachmentError(e)).filter(Boolean)
<<<<<<< HEAD
    return parts.length ? Array.from(new Set(parts)).join('; ') : 'Unknown error'
  }
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>
    const candidates = [
      obj.message,
      obj.reason,
      obj.detail,
    ]
=======
    return parts.length
      ? Array.from(new Set(parts)).join('; ')
      : 'Unknown error'
  }
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>
    const candidates = [obj.message, obj.reason, obj.detail]
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    for (const val of candidates) {
      if (typeof val === 'string' && val.trim().length > 0) {
        return val
      }
    }
    const nestedSources = [obj.error, obj.cause]
    for (const nested of nestedSources) {
      if (nested && typeof nested === 'object') {
        const nestedMsg = formatAttachmentError(nested)
        if (nestedMsg && nestedMsg !== 'Unknown error') {
          return nestedMsg
        }
      } else if (typeof nested === 'string' && nested.trim().length > 0) {
        return nested
      }
    }
    if (typeof obj.code === 'string' && obj.code.trim().length > 0) {
      return obj.code
    }
    try {
      return JSON.stringify(obj)
    } catch {
      return String(err)
    }
  }
  return String(err)
}

export const processAttachmentsForSend = async (
  options: AttachmentProcessingOptions
): Promise<AttachmentProcessingResult> => {
  const {
    attachments,
    threadId,
<<<<<<< HEAD
=======
    projectId,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    serviceHub,
    contextThreshold,
    estimateTokens,
    parsePreference,
    autoFallbackMode,
    perFileChoices,
    updateAttachmentProcessing,
  } = options

<<<<<<< HEAD
  const fileAttachmentsFeatureEnabled = PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS]
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  const processedAttachments: Attachment[] = []
  let hasEmbeddedDocuments = false
  const effectiveContextThreshold =
    typeof contextThreshold === 'number' &&
    Number.isFinite(contextThreshold) &&
    contextThreshold > 0
      ? contextThreshold
      : undefined
  const notifyUpdate = (
<<<<<<< HEAD
    ...args: Parameters<NonNullable<AttachmentProcessingOptions['updateAttachmentProcessing']>>
=======
    ...args: Parameters<
      NonNullable<AttachmentProcessingOptions['updateAttachmentProcessing']>
    >
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  ) => updateAttachmentProcessing?.(...args)

  // Images: ingest before sending
  const images = attachments.filter((a) => a.type === 'image')
  if (images.length > 0) {
    for (const img of images) {
      try {
        if (img.processed && img.id) {
          processedAttachments.push(img)
          continue
        }

        notifyUpdate(img.name, 'processing')

        const res = await serviceHub.uploads().ingestImage(threadId, img)
        processedAttachments.push({
          ...img,
          id: res.id,
          processed: true,
          processing: false,
        })
        notifyUpdate(img.name, 'done', {
          id: res.id,
          processed: true,
          processing: false,
        })
      } catch (err) {
        console.error(`Failed to ingest image ${img.name}:`, err)
        notifyUpdate(img.name, 'error')
        const desc = formatAttachmentError(err)
        toast.error('Failed to ingest image attachment', { description: desc })
        throw err instanceof Error ? err : new Error(desc)
      }
    }
  }

<<<<<<< HEAD
  if (fileAttachmentsFeatureEnabled) {
    const documents = attachments.filter((a) => a.type === 'document')
    for (const doc of documents) {
      try {
        if (doc.processed && (doc.id || doc.injectionMode === 'inline')) {
          hasEmbeddedDocuments = hasEmbeddedDocuments || doc.injectionMode !== 'inline'
          processedAttachments.push(doc)
          continue
        }

        notifyUpdate(doc.name, 'processing')

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
          // Check if user made a per-file choice for this document
          const userChoice = perFileChoices?.get(doc.path || '')
          targetMode = userChoice ?? autoFallbackMode ?? 'embeddings'

          // Only do auto-detection if no user choice was made
          if (!userChoice && parsedContent && estimateTokens) {
            const estimatedTokens = await estimateTokens(parsedContent)
            const tokenCount =
              typeof estimatedTokens === 'number' &&
              Number.isFinite(estimatedTokens) &&
              estimatedTokens > 0
                ? estimatedTokens
                : undefined
            if (!effectiveContextThreshold) {
              console.debug(
                `Attachment ${doc.name}: no context threshold available; defaulting to ${targetMode}`
              )
            } else if (typeof tokenCount === 'number') {
              targetMode =
                tokenCount <= effectiveContextThreshold ? 'inline' : 'embeddings'
            } else {
              console.debug(
                `Attachment ${doc.name}: token estimate unavailable or non-positive; defaulting to ${targetMode}`
              )
            }
          } else if (!userChoice && !parsedContent) {
            console.debug(
              `Attachment ${doc.name}: parsed content unavailable for token estimation; defaulting to ${targetMode}`
            )
          } else if (!userChoice) {
            console.debug(
              `Attachment ${doc.name}: token estimator unavailable; defaulting to ${targetMode}`
            )
          }
        } else if (targetPreference === 'prompt') {
          // Check if user made a per-file choice for this document
          const userChoice = perFileChoices?.get(doc.path || '')
          targetMode = userChoice ?? autoFallbackMode ?? 'embeddings'
        }

        if (targetMode === 'inline' && parsedContent) {
          processedAttachments.push({
            ...doc,
            processing: false,
            processed: true,
            inlineContent: parsedContent,
            injectionMode: 'inline',
          })

          notifyUpdate(doc.name, 'done', {
            processing: false,
            processed: true,
            inlineContent: parsedContent,
            injectionMode: 'inline',
          })
          continue
        }

        // Default: ingest as embeddings
        notifyUpdate(doc.name, 'processing')

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

        notifyUpdate(doc.name, 'done', {
          id: res.id,
          size: res.size ?? doc.size,
          chunkCount: res.chunkCount ?? doc.chunkCount,
          processing: false,
          processed: true,
          injectionMode: 'embeddings',
        })
      } catch (err) {
        console.error(`Failed to ingest ${doc.name}:`, err)
        notifyUpdate(doc.name, 'error')
        const desc = formatAttachmentError(err)
        toast.error('Failed to index attachments', { description: desc })
        throw err instanceof Error ? err : new Error(desc)
      }
=======
  const documents = attachments.filter((a) => a.type === 'document')
  for (const doc of documents) {
    try {
      if (doc.processed && (doc.id || doc.injectionMode === 'inline')) {
        hasEmbeddedDocuments =
          hasEmbeddedDocuments || doc.injectionMode !== 'inline'
        processedAttachments.push(doc)
        continue
      }

      notifyUpdate(doc.name, 'processing')

      const targetPreference = doc.parseMode ?? parsePreference
      let targetMode: 'inline' | 'embeddings' =
        targetPreference === 'inline' ? 'inline' : 'embeddings'
      let parsedContent: string | undefined

      // Project files always use embeddings, never inline
      if (projectId) {
        targetMode = 'embeddings'
      }

      const canInline = !projectId && targetPreference !== 'embeddings' && !!doc.path

      if (canInline) {
        try {
          parsedContent = await serviceHub
            .rag()
            .parseDocument?.(doc.path!, doc.fileType)
        } catch (err) {
          console.warn(`Failed to parse ${doc.name} for inline use`, err)
        }
      }

      if (targetPreference === 'auto') {
        // Check if user made a per-file choice for this document
        const userChoice = perFileChoices?.get(doc.path || '')
        // Project files always use embeddings
        const effectiveMode = projectId ? 'embeddings' : (userChoice ?? autoFallbackMode ?? 'embeddings')
        targetMode = effectiveMode

        // Only do auto-detection if no user choice was made and not project file
        if (!projectId && !userChoice && parsedContent && estimateTokens) {
          const estimatedTokens = await estimateTokens(parsedContent)
          const tokenCount =
            typeof estimatedTokens === 'number' &&
            Number.isFinite(estimatedTokens) &&
            estimatedTokens > 0
              ? estimatedTokens
              : undefined
          if (!effectiveContextThreshold) {
            console.debug(
              `Attachment ${doc.name}: no context threshold available; defaulting to ${targetMode}`
            )
          } else if (typeof tokenCount === 'number') {
            targetMode =
              tokenCount <= effectiveContextThreshold ? 'inline' : 'embeddings'
          } else {
            console.debug(
              `Attachment ${doc.name}: token estimate unavailable or non-positive; defaulting to ${targetMode}`
            )
          }
        } else if (!projectId && !userChoice && !parsedContent) {
          console.debug(
            `Attachment ${doc.name}: parsed content unavailable for token estimation; defaulting to ${targetMode}`
          )
        } else if (!projectId && !userChoice) {
          console.debug(
            `Attachment ${doc.name}: token estimator unavailable; defaulting to ${targetMode}`
          )
        }
      } else if (targetPreference === 'prompt') {
        // Check if user made a per-file choice for this document
        const userChoice = perFileChoices?.get(doc.path || '')
        // Project files always use embeddings
        targetMode = projectId ? 'embeddings' : (userChoice ?? autoFallbackMode ?? 'embeddings')
      }

      if (targetMode === 'inline' && parsedContent) {
        processedAttachments.push({
          ...doc,
          processing: false,
          processed: true,
          inlineContent: parsedContent,
          injectionMode: 'inline',
        })

        notifyUpdate(doc.name, 'done', {
          processing: false,
          processed: true,
          inlineContent: parsedContent,
          injectionMode: 'inline',
        })
        continue
      }

      // Default: ingest as embeddings
      notifyUpdate(doc.name, 'processing')

      const res = projectId
        ? await serviceHub.uploads().ingestFileAttachmentForProject(projectId, doc)
        : await serviceHub.uploads().ingestFileAttachment(threadId, doc)

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

      notifyUpdate(doc.name, 'done', {
        id: res.id,
        size: res.size ?? doc.size,
        chunkCount: res.chunkCount ?? doc.chunkCount,
        processing: false,
        processed: true,
        injectionMode: 'embeddings',
      })
    } catch (err) {
      console.error(`Failed to ingest ${doc.name}:`, err)
      notifyUpdate(doc.name, 'error')
      const desc = formatAttachmentError(err)
      toast.error('Failed to index attachments', { description: desc })
      throw err instanceof Error ? err : new Error(desc)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    }
  }

  return { processedAttachments, hasEmbeddedDocuments }
}
