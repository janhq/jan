import type { UIMessage } from 'ai'

/** Adapter notices are UI, never model-authored prefill or prompt history. */
export const CHAT_RUN_NOTICE_METADATA = { jan: { chatRunNotice: true } }

export function isChatRunNotice(part: UIMessage['parts'][number]): boolean {
  return part.type === 'text' && part.providerMetadata?.jan?.chatRunNotice === true
}

export function withoutChatRunNotices(messages: UIMessage[]): UIMessage[] {
  return messages.map(message => message.parts.some(isChatRunNotice)
    ? { ...message, parts: message.parts.filter(part => !isChatRunNotice(part)) }
    : message)
}
