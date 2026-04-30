import type { UIMessage } from '@ai-sdk/react'
import { generateId } from 'ai'

import { newUserThreadContent } from '@/lib/completion'
import { convertThreadMessageToUIMessage } from '@/lib/messages'
import { Attachment, createImageAttachment } from '@/types/attachment'

export type OptimisticImageFile = {
  type: string
  mediaType: string
  url: string
}

/**
 * Build an optimistic user `UIMessage` ready to render in the chat. Returns
 * `null` if there are no attachments — the optimistic bubble is only useful
 * when the user actually expects to see something (e.g. a file chip + a
 * "Indexing attachments..." shimmer) while backend work is in flight.
 *
 * The text and combined attachments must mirror what the eventual
 * `processAndSendMessage` will produce, so the real UIMessage queued by
 * `sendMessage` replaces the optimistic one in-place without a layout jump.
 */
export const buildOptimisticUserMessage = ({
  threadId,
  text,
  imageFiles,
  documents,
  messageId,
}: {
  threadId: string
  text: string
  imageFiles?: OptimisticImageFile[]
  documents?: Attachment[]
  messageId?: string
}): UIMessage | null => {
  const docs = documents ?? []
  const images = imageFiles ?? []
  if (docs.length === 0 && images.length === 0) return null

  const imageAttachments: Attachment[] = images.map((file) => {
    const base64 = file.url.split(',')[1] || ''
    return createImageAttachment({
      name: `image-${Date.now()}`,
      mimeType: file.mediaType,
      dataUrl: file.url,
      base64,
      size: Math.ceil((base64.length * 3) / 4),
    })
  })

  const combined = [...imageAttachments, ...docs]
  const id = messageId ?? generateId()
  const threadMsg = newUserThreadContent(threadId, text, combined, id)
  return convertThreadMessageToUIMessage(threadMsg)
}
