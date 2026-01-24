/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ContentType,
  ChatCompletionRole,
  ThreadMessage,
  MessageStatus,
} from '@janhq/core'
import { ulid } from 'ulidx'
import { Attachment } from '@/types/attachment'
import { injectFilesIntoPrompt } from './fileMetadata'

/**
 * @fileoverview Helper functions for creating thread content.
 * These functions are used to create thread content objects
 * for different types of content, such as text and image.
 * The functions return objects that conform to the `ThreadContent` type.
 * @param content - The content of the thread
 * @returns
 */
export const newUserThreadContent = (
  threadId: string,
  content: string,
  attachments?: Attachment[],
  id?: string
): ThreadMessage => {
  // Separate images and documents
  const images = attachments?.filter((a) => a.type === 'image') || []
  const documents = attachments?.filter((a) => a.type === 'document') || []

  const inlineDocuments = documents.filter(
    (doc) => doc.injectionMode === 'inline' && doc.inlineContent
  )

  // Inject document metadata into the text content (id, name, fileType only - no path)
  const docMetadata = documents
    .map((doc) => ({
      id: doc.id ?? doc.name,
      name: doc.name,
      type: doc.fileType,
      size: typeof doc.size === 'number' ? doc.size : undefined,
      chunkCount: typeof doc.chunkCount === 'number' ? doc.chunkCount : undefined,
      injectionMode: doc.injectionMode,
    }))

  const textWithFiles =
    docMetadata.length > 0 ? injectFilesIntoPrompt(content, docMetadata) : content

  const contentParts = [
    {
      type: ContentType.Text,
      text: {
        value: textWithFiles,
        annotations: [],
      },
    },
  ]

  // Add image attachments to content array
  images.forEach((img) => {
    if (img.base64 && img.mimeType) {
      contentParts.push({
        type: ContentType.Image,
        image_url: {
          url: `data:${img.mimeType};base64,${img.base64}`,
          detail: 'auto',
        },
      } as any)
    }
  })

  return {
    type: 'text',
    role: ChatCompletionRole.User,
    content: contentParts,
    id: id ?? ulid(),
    object: 'thread.message',
    thread_id: threadId,
    status: MessageStatus.Ready,
    created_at: 0,
    completed_at: 0,
    metadata:
      inlineDocuments.length > 0
        ? {
            inline_file_contents: inlineDocuments.map((doc) => ({
              name: doc.name,
              content: doc.inlineContent,
            })),
          }
        : undefined,
  }
}

/**
 * @fileoverview Helper functions for creating thread content.
 * These functions are used to create thread content objects
 * for different types of content, such as text and image.
 * The functions return objects that conform to the `ThreadContent` type.
 * @param content - The content of the thread
 * @returns
 */
export const newAssistantThreadContent = (
  threadId: string,
  content: string,
  metadata: Record<string, unknown> = {},
  id?: string,
): ThreadMessage => ({
  type: 'text',
  role: ChatCompletionRole.Assistant,
  content: [
    {
      type: ContentType.Text,
      text: {
        value: content,
        annotations: [],
      },
    },
  ],
  id: id ?? ulid(),
  object: 'thread.message',
  thread_id: threadId,
  status: MessageStatus.Ready,
  created_at: 0,
  completed_at: 0,
  metadata,
})

/**
 * Empty thread content object.
 * @returns
 */
export const emptyThreadContent: ThreadMessage = {
  type: 'text',
  role: ChatCompletionRole.Assistant,
  id: ulid(),
  object: 'thread.message',
  thread_id: '',
  content: [],
  status: MessageStatus.Ready,
  created_at: 0,
  completed_at: 0,
}
