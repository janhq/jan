import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { UIMessage } from '@ai-sdk/react'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const getInitialsAvatar = (name: string) => {
  const words = name.trim().split(/\s+/)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  return words[0][0].toUpperCase()
}

// Convert ConversationItem[] to UIMessage[]
export const convertToUIMessages = (items: ConversationItem[]): UIMessage[] => {
  return items.map((item) => {
    const parts = item.content.map((content) => {
      // Determine the content type
      let contentType: 'text' | 'reasoning' | 'file' = 'text'

      if (content.type === 'reasoning_text') {
        contentType = 'reasoning'
      } else if (content.type === 'input_text' || content.type === 'text') {
        contentType = 'text'
      } else if (content.type === 'image') {
        contentType = 'file'
      } else {
        contentType = content.type as 'text' | 'reasoning' | 'file'
      }

      return {
        type: contentType,
        text:
          content.text?.text ||
          content.text ||
          content.input_text ||
          content.reasoning_content ||
          '',
        mediaType: contentType === 'file' ? 'image/jpeg' : undefined,
        url: contentType === 'file' ? content.image?.url : undefined,
      }
    })

    // Sort parts: reasoning first, then other types
    const sortedParts = parts.sort((a, b) => {
      if (a.type === 'reasoning' && b.type !== 'reasoning') return -1
      if (a.type !== 'reasoning' && b.type === 'reasoning') return 1
      return 0
    })

    return {
      id: item.id,
      role: item.role as 'user' | 'assistant' | 'system',
      parts: sortedParts,
    } as UIMessage
  })
}
