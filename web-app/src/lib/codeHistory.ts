import type { CodeMessage } from '@/hooks/useCodeSessions'

// The agent core represents a tool-call turn as
// `{role:'assistant', content:null, tool_calls:[...]}` — legal OpenAI protocol.
// `messages_updated` streams those to the front-end verbatim, but `CodeMessage`
// cannot model `tool_calls`, so persisting one leaves an assistant turn carrying
// no information at all.
//
// These helpers keep such an entry from (a) throwing on `.content.length` and
// (b) being replayed to the model as an empty turn. Deliberately tolerant rather
// than strict: sessions persisted by an earlier build already contain these, and
// they must keep working without a data migration.

/** Character/part count, 0 for content the type doesn't actually model. */
export const contentLength = (content: CodeMessage['content']): number =>
  typeof content === 'string' || Array.isArray(content) ? content.length : 0

/** True when a message carries something worth persisting and replaying. */
export const hasContent = (message: CodeMessage): boolean =>
  typeof message.content === 'string'
    ? message.content.trim().length > 0
    : Array.isArray(message.content) && message.content.length > 0
