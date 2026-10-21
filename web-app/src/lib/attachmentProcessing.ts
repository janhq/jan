import { ServiceHub } from '@/services'
import { Attachment } from '@/types/attachment'
import { toast } from 'sonner'
import { estimateTokens } from '@/lib/context-manager'
import { useAttachmentIngestionPrompt } from '@/hooks/useAttachmentIngestionPrompt'
import {
  getLocalPropsExtension,
  readCtxLen,
} from '@/lib/llamacppRouterProps'

type AttachmentProcessingStatus = 'processing' | 'done' | 'error' | 'clear_all'

export type AttachmentIngestProgress = {
  completed: number
  total: number
}

type AttachmentProcessingOptions = {
  attachments: Attachment[]
  threadId: string
  projectId?: string
  serviceHub: ServiceHub
  selectedProvider?: string
  /**
   * Whether the selected model can call tools. Project documents are embedded
   * unless this is false, since only a tool-capable model can retrieve them.
   */
  modelSupportsTools?: boolean
  /** Token budget under which an 'auto' document is inlined; see resolveAutoInlineBudget. */
  contextThreshold?: number
  parsePreference: 'auto' | 'inline' | 'embeddings' | 'prompt'
  updateAttachmentProcessing?: (
    name: string,
    status: AttachmentProcessingStatus,
    updatedAttachment?: Partial<Attachment>
  ) => void
  /** Fired when attachment ingestion advances (multi-file uploads). */
  onIngestProgress?: (state: AttachmentIngestProgress) => void
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
    return parts.length
      ? Array.from(new Set(parts)).join('; ')
      : 'Unknown error'
  }
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>
    const candidates = [obj.message, obj.reason, obj.detail]
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

type ParsePreference = AttachmentProcessingOptions['parsePreference']

/**
 * Token budget an 'auto' document may use to be inlined: the model's context
 * window times the user's auto-inline ratio. Only local models have a window
 * the app knows (configured ctx_len, or the launched n_ctx when ctx_len is
 * left to auto-fit and the model is already loaded). Cloud providers expose
 * no context-window metadata, so they get undefined and the user is asked.
 * `usedTokens` is what the conversation already occupies: a document that
 * fits the bare window can still overflow it on top of a long thread.
 */
export const resolveAutoInlineBudget = async (
  model: Model | null | undefined,
  provider: string | undefined,
  ratio: number | undefined,
  usedTokens = 0
): Promise<number | undefined> => {
  if (!model || typeof ratio !== 'number' || !(ratio > 0)) return undefined
  let ctxLen = readCtxLen(model.settings?.ctx_len?.controller_props?.value)
  if (!ctxLen) {
    try {
      const props = await getLocalPropsExtension(provider)?.getModelProps?.(
        model.id
      )
      ctxLen = readCtxLen(props?.nCtx)
    } catch {
      // Not loaded yet: the window is unknown until the router launches it.
    }
  }
  if (!ctxLen) return undefined
  const budget = Math.floor(ctxLen * ratio) - usedTokens
  return budget > 0 ? budget : undefined
}

/**
 * Whether the user must pick inline vs embeddings for a document. 'auto' only
 * asks when there is no budget to decide by size. Checked at attach time and
 * again at send time, since the budget can disappear in between (model
 * switched or unloaded, conversation grown).
 */
export const needsIngestionChoice = (
  doc: Attachment,
  parsePreference: ParsePreference,
  hasInlineBudget: boolean
): boolean => {
  if (doc.processed || doc.injectionMode) return false
  const preference = doc.parseMode ?? parsePreference
  return preference === 'prompt' || (preference === 'auto' && !hasInlineBudget)
}

/**
 * How a new document is parsed for the selected model. An embedded document is
 * read back through the retrieval tool, which a model without tool support can
 * never call, so such a model gets the document in the prompt whatever the
 * preference says (#9363).
 */
export const parseModeForModel = (
  parsePreference: ParsePreference,
  modelSupportsTools: boolean
): ParsePreference => (modelSupportsTools ? parsePreference : 'inline')

export type IngestionChoice = 'inline' | 'embeddings'

/**
 * Asks the user, one document at a time, whether to inline or embed it.
 * Resolves to each choice keyed by document path, or undefined as soon as the
 * user cancels.
 */
export const promptIngestionChoices = async (
  docs: Attachment[]
): Promise<Map<string, IngestionChoice> | undefined> => {
  const choices = new Map<string, IngestionChoice>()
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]
    const choice = await useAttachmentIngestionPrompt
      .getState()
      .showPrompt(doc, i, docs.length)
    if (!choice) return undefined
    if (doc.path) choices.set(doc.path, choice)
  }
  return choices
}

/** Records each choice as its document's parseMode, which send time honours. */
export const applyIngestionChoices = (
  attachments: Attachment[],
  choices: Map<string, IngestionChoice>
): Attachment[] =>
  attachments.map((att) => {
    const mode = att.path ? choices.get(att.path) : undefined
    return mode ? { ...att, parseMode: mode } : att
  })

export const processAttachmentsForSend = async (
  options: AttachmentProcessingOptions
): Promise<AttachmentProcessingResult> => {
  const {
    attachments,
    threadId,
    projectId,
    serviceHub,
    contextThreshold,
    parsePreference,
    updateAttachmentProcessing,
    onIngestProgress,
  } = options
  const inlineAllowed = !projectId || options.modelSupportsTools === false
  // A model that cannot call the retrieval tool can only use a document that
  // is in its prompt, whatever the preference or the document's size.
  const needsInline = options.modelSupportsTools === false

  const processedAttachments: Attachment[] = []
  let hasEmbeddedDocuments = false

  const imagesToProcess = attachments.filter(
    (img) => img.type === 'image' && !(img.processed && img.id)
  )
  const documentsToProcess = attachments.filter(
    (doc) =>
      doc.type === 'document' &&
      !(doc.processed && (doc.id || doc.injectionMode === 'inline'))
  )
  const ingestTotal = imagesToProcess.length + documentsToProcess.length
  let ingestCompleted = 0
  const bumpIngest = () => {
    if (!onIngestProgress || ingestTotal <= 0) return
    ingestCompleted += 1
    onIngestProgress({
      completed: Math.min(ingestCompleted, ingestTotal),
      total: ingestTotal,
    })
  }
  if (onIngestProgress && ingestTotal > 0) {
    onIngestProgress({ completed: 0, total: ingestTotal })
  }
  const effectiveContextThreshold =
    typeof contextThreshold === 'number' &&
    Number.isFinite(contextThreshold) &&
    contextThreshold > 0
      ? contextThreshold
      : undefined
  // One budget for the whole send: each document that fits alone could still
  // overflow the window together with the others inlined before it.
  let remainingInlineBudget = effectiveContextThreshold ?? 0
  const notifyUpdate = (
    ...args: Parameters<
      NonNullable<AttachmentProcessingOptions['updateAttachmentProcessing']>
    >
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
        bumpIngest()
      } catch (err) {
        console.error(`Failed to ingest image ${img.name}:`, err)
        notifyUpdate(img.name, 'error')
        const desc = formatAttachmentError(err)
        toast.error('Failed to ingest image attachment', { description: desc })
        throw err instanceof Error ? err : new Error(desc)
      }
    }
  }

  const audios = attachments.filter((a) => a.type === 'audio')
  for (const aud of audios) {
    processedAttachments.push({
      ...aud,
      processed: true,
      processing: false,
    })
  }

  const videos = attachments.filter((a) => a.type === 'video')
  for (const vid of videos) {
    processedAttachments.push({
      ...vid,
      processed: true,
      processing: false,
    })
  }

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
      // Project files use embeddings, never inline, unless the model cannot
      // call the retrieval tool: an embedded document would then be
      // unreachable, so it goes in the prompt (#9363). 'prompt' documents
      // carry the user's pick in parseMode, so reaching here means no pick
      // was recorded and the safe default applies.
      const decideBySize =
        inlineAllowed &&
        !needsInline &&
        targetPreference === 'auto' &&
        effectiveContextThreshold !== undefined
      const wantsInline =
        inlineAllowed &&
        (needsInline || targetPreference === 'inline' || decideBySize)
      let targetMode: 'inline' | 'embeddings' = 'embeddings'
      let parsedContent: string | undefined

      if (wantsInline && doc.path) {
        try {
          parsedContent = await serviceHub
            .rag()
            .parseDocument?.(doc.path, doc.fileType)
        } catch (err) {
          console.warn(`Failed to parse ${doc.name} for inline use`, err)
        }
      }

      // An embedded copy is unreachable for this model, so a document that
      // could not be read as text must fail the send, not go through
      // without its content.
      if (needsInline && !parsedContent) {
        throw new Error(
          `Couldn't read ${doc.name} as text. This model can't search files, so the document can't be added.`
        )
      }

      if (parsedContent) {
        const tokens = estimateTokens(parsedContent)
        targetMode =
          !decideBySize || tokens <= remainingInlineBudget
            ? 'inline'
            : 'embeddings'
        if (targetMode === 'inline') remainingInlineBudget -= tokens
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
        bumpIngest()
        continue
      }

      // Default: ingest as embeddings.
      // Also reached when targetMode is 'inline' but parsedContent is absent
      // (i.e. parsing failed above) — intentional: embeddings is the safe fallback.
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
      bumpIngest()
    } catch (err) {
      console.error(`Failed to ingest ${doc.name}:`, err)
      notifyUpdate(doc.name, 'error')
      const desc = formatAttachmentError(err)
      toast.error('Failed to index attachments', { description: desc })
      throw err instanceof Error ? err : new Error(desc)
    }
  }

  return { processedAttachments, hasEmbeddedDocuments }
}
