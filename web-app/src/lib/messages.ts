/* eslint-disable @typescript-eslint/no-explicit-any */
import { TOOL_DIFF_MAX_CHARS } from './toolDiff'
import {
  ThreadMessage,
  ContentType,
  MessageStatus,
  ChatCompletionRole,
} from '@janhq/core'
import type { UIMessage } from '@ai-sdk/react'
import { isChatRunNotice } from './chatRunNotice'
import { isRunContextData } from './chatRunContext'
import {
  TASK_STATUS_CARRIER_TEXT_LIMIT,
  shapeTaskStatusPart,
  stripTaskStatusPart,
  taskStatusHasBulk,
  truncateTaskStatusPart,
} from './chatTaskStatus'
// Attachments are now handled upstream in newUserThreadContent

type ThreadContent = NonNullable<ThreadMessage['content']>[number]

/**
 * Convert AI SDK UIMessage to Jan's ThreadMessage format.
 * This allows using chatMessages from useChat with ThreadContent component.
 */
export function convertUIMessageToThreadMessage(
  uiMessage: UIMessage,
  threadId: string
): ThreadMessage {
  const content: ThreadContent[] = []

  // Extract text and image parts from UIMessage
  // Use 'any' for parts since the AI SDK types vary between versions
  for (const part of uiMessage.parts as any[]) {
    if (part.type === 'text') {
      content.push({
        type: ContentType.Text,
        text: {
          value: part.text,
          annotations: [],
        },
      })
    } else if (part.type === 'reasoning') {
      // Wrap reasoning in <think> tags for compatibility with existing rendering
      // The reasoning content is in 'reasoning' or 'text' depending on SDK version
      const reasoningText = part.reasoning ?? part.text ?? ''
      const existingText = content.find((c) => c.type === ContentType.Text)
      if (existingText && existingText.text) {
        existingText.text.value = `<think>${reasoningText}</think>${existingText.text.value}`
      } else {
        content.unshift({
          type: ContentType.Text,
          text: {
            value: `<think>${reasoningText}</think>`,
            annotations: [],
          },
        })
      }
    } else if (part.type === 'file' && part.mediaType) {
      const mediaType = part.mediaType as string
      if (mediaType?.startsWith('image/')) {
        content.push({
          type: ContentType.Image,
          image_url: {
            url: part.url,
            detail: 'auto',
          },
        })
      } else if (mediaType === 'audio/wav' || mediaType === 'audio/mpeg') {
        const format = mediaType === 'audio/wav' ? 'wav' : 'mp3'
        const url = part.url as string | undefined
        const data =
          typeof url === 'string' && url.startsWith('data:')
            ? url.slice(url.indexOf(',') + 1)
            : (url ?? '')
        content.push({
          type: ContentType.InputAudio,
          input_audio: { data, format },
        })
      } else if (mediaType?.startsWith('video/')) {
        const url = part.url as string | undefined
        const data =
          typeof url === 'string' && url.startsWith('data:')
            ? url.slice(url.indexOf(',') + 1)
            : (url ?? '')
        content.push({
          type: ContentType.InputVideo,
          input_video: { data, format: mediaType },
        })
      }
    }
  }

  // If no content was extracted, add empty text
  if (content.length === 0) {
    content.push({
      type: ContentType.Text,
      text: {
        value: '',
        annotations: [],
      },
    })
  }

  // Extract tool calls from parts
  const toolCalls = (uiMessage.parts as any[])
    .filter((part) => part.type.startsWith('tool'))
    .map((part) => {
      const toolName = part.type.replace('tool-', '')
      return {
        tool: {
          id: part.toolCallId || part.toolInvocationId,
          type: 'function' as const,
          function: {
            name: toolName,
            arguments:
              typeof part.input === 'string'
                ? part.input
                : JSON.stringify(part.input ?? part.args),
          },
        },
        state: part.state === 'output-available' ? 'completed' : 'pending',
        response: part.output ?? part.result,
      }
    })

  const metadata = uiMessage.metadata as Record<string, unknown> | undefined
  const createdAt =
    metadata?.createdAt instanceof Date ? metadata.createdAt.getTime() : Date.now()

  return {
    id: uiMessage.id,
    object: 'thread.message',
    thread_id: threadId,
    role: uiMessage.role as ThreadMessage['role'],
    content,
    status: MessageStatus.Ready,
    created_at: createdAt,
    completed_at: createdAt,
    metadata: toolCalls.length > 0 ? { tool_calls: toolCalls } : undefined,
  }
}

/**
 * Convert an array of AI SDK UIMessages to Jan's ThreadMessage format.
 */
export function convertUIMessagesToThreadMessages(
  uiMessages: UIMessage[],
  threadId: string
): ThreadMessage[] {
  return uiMessages.map((msg) => convertUIMessageToThreadMessage(msg, threadId))
}

// Define a temporary type for the expected tool result shape (ToolResult as before)
export type ToolResult = {
  content: Array<{
    type?: string
    text?: string
    data?: string
    image_url?: { url: string; detail?: string }
  }>
  error?: string
}

// Reasoning models wrap their chain-of-thought in a tag we strip out: <think>,
// <thought> (Gemma), <thinking>, <reasoning>, plus namespaced variants like
// <mm:think> (MiniMax). Matches an optional `ns:` prefix + a known keyword and
// tolerates attributes on the opening tag. `\1` binds the close tag to the open.
const REASONING_TAG = '(?:[a-zA-Z][a-zA-Z0-9]*:)?(?:think|thinking|thought|reasoning)'
const openReasoningTagRe = () => new RegExp(`<(${REASONING_TAG})(?:\\s[^>]*)?>`, 'i')
const completedReasoningTagRe = () =>
  new RegExp(`<(${REASONING_TAG})(?:\\s[^>]*)?>([\\s\\S]*?)</\\1>`, 'i')

/**
 * Parse reasoning segments from the given text.
 * @param text - The text to parse reasoning from.
 * @returns
 */
export const parseReasoning = (text: string) => {
  // In-progress reasoning: an opening tag whose matching close hasn't streamed yet.
  const openTag = text.match(openReasoningTagRe())
  const hasThinkTag = openTag
    ? !new RegExp(`</${openTag[1]}>`, 'i').test(text)
    : false
  const hasAnalysisChannel =
    text.includes('<|channel|>analysis<|message|>') &&
    !text.includes('<|start|>assistant<|channel|>final<|message|>')

  if (hasThinkTag || hasAnalysisChannel)
    return { reasoningSegment: text, textSegment: '' }

  // Check for completed think tag format
  const thinkMatch = text.match(completedReasoningTagRe())
  if (thinkMatch?.index !== undefined) {
    const splitIndex = thinkMatch.index + thinkMatch[0].length
    return {
      reasoningSegment: text.slice(0, splitIndex),
      textSegment: text.slice(splitIndex),
    }
  }

  // Check for completed analysis channel format
  const analysisMatch = text.match(
    /<\|channel\|>analysis<\|message\|>([\s\S]*?)<\|start\|>assistant<\|channel\|>final<\|message\|>/
  )
  if (analysisMatch?.index !== undefined) {
    const splitIndex = analysisMatch.index + analysisMatch[0].length
    return {
      reasoningSegment: text.slice(0, splitIndex),
      textSegment: text.slice(splitIndex),
    }
  }

  return { reasoningSegment: undefined, textSegment: text }
}

export type ReasoningTextPart = { type: 'reasoning' | 'text'; text: string }

/**
 * Split a raw assistant string into reasoning/text UIMessage parts, pulling out
 * `<think>`/`<thought>`-wrapped reasoning (via {@link parseReasoning}) so it
 * renders in the collapsible reasoning UI instead of inline as literal tags.
 * Shared by the chat message loader and the code agent transcript so both
 * surface reasoning the same way.
 */
export function reasoningPartsFromText(text: string): ReasoningTextPart[] {
  const parts: ReasoningTextPart[] = []
  const { reasoningSegment, textSegment } = parseReasoning(text)

  if (reasoningSegment) {
    // Extract the reasoning text from inside the tag (group 2 = content).
    const completedMatch = reasoningSegment.match(
      new RegExp(`<(${REASONING_TAG})(?:\\s[^>]*)?>([\\s\\S]*)</\\1>`, 'i')
    )
    if (completedMatch) {
      parts.push({ type: 'reasoning', text: completedMatch[2] })
    } else {
      // In-progress reasoning - content after an unclosed reasoning tag.
      const inProgressMatch = reasoningSegment.match(
        new RegExp(`<(${REASONING_TAG})(?:\\s[^>]*)?>([\\s\\S]*)`, 'i')
      )
      if (inProgressMatch) {
        parts.push({ type: 'reasoning', text: inProgressMatch[2] })
      }
    }
  }

  if (textSegment) {
    const trimmedText = textSegment.trim()
    if (trimmedText) parts.push({ type: 'text', text: trimmedText })
  } else if (!reasoningSegment) {
    // No reasoning segment, just add the text as-is.
    parts.push({ type: 'text', text })
  }

  return parts
}

/**
 * Convert Jan's ThreadMessage format to AI SDK UIMessage format.
 * This is used to load existing messages into the AI SDK chat.
 * Tool calls are now part of the content array and will be converted to tool parts.
 */
export function convertThreadMessageToUIMessage(
  threadMessage: ThreadMessage
): UIMessage {
  const { uiParts, ...metadata } = (threadMessage.metadata || {}) as Record<
    string,
    unknown
  >
  // `uiPartsSkipped` stays visible: that turn reloads (and is re-sent) lossy.
  const rehydrated = rehydrateUIParts(
    uiParts,
    threadMessage.content || [],
    metadata.toolErrors
  )
  const parts: any[] = rehydrated?.parts ?? contentToUIParts(threadMessage)
  // Display-only status parts dropped on this read are counted, on top of any
  // omission the writer already recorded. Never written back (the writer
  // clears it on rebuild), so no authority changes.
  if (rehydrated?.dropped) {
    const prior = priorTaskStatusShed(metadata.uiTaskStatusShed)
    metadata.uiTaskStatusShed = {
      ...prior,
      dropped: (prior.dropped ?? 0) + rehydrated.dropped,
    }
  }

  return {
    id: threadMessage.id,
    role: threadMessage.role as 'user' | 'assistant' | 'system',
    parts,
    metadata: {
      ...metadata,
      createdAt: new Date(threadMessage.created_at || Date.now()),
    },
  } as UIMessage
}

// The parts a record reloads to from its `content` (and legacy
// `metadata.tool_calls`) alone: what every record reloaded to before
// `metadata.uiParts`, and what one still reloads to without a usable carrier.
function contentToUIParts(threadMessage: ThreadMessage): any[] {
  const parts: any[] = []

  // Process content array - preserve original order (including tool calls)
  for (const content of threadMessage.content || []) {
    if (content.type === 'reasoning' && content.text?.value) {
      // Reasoning content - direct conversion
      parts.push({
        type: 'reasoning',
        text: content.text.value,
      })
    } else if (content.type === 'text' && content.text?.value) {
      // Text content - split out any legacy <think>/<thought> reasoning so it
      // renders in the reasoning UI instead of inline (see reasoningPartsFromText).
      parts.push(...reasoningPartsFromText(content.text.value))
    } else if (content.type === 'image_url' && content.image_url?.url) {
      parts.push({
        type: 'file',
        mediaType: 'image/jpeg',
        url: content.image_url.url,
      })
    } else if (content.type === 'input_audio' && content.input_audio?.data) {
      const fmt = content.input_audio.format
      const mediaType = fmt === 'mp3' ? 'audio/mpeg' : 'audio/wav'
      parts.push({
        type: 'file',
        mediaType,
        url: `data:${mediaType};base64,${content.input_audio.data}`,
      })
    } else if (content.type === 'input_video' && content.input_video?.data) {
      const mediaType = content.input_video.format || 'video/mp4'
      parts.push({
        type: 'file',
        mediaType,
        url: `data:${mediaType};base64,${content.input_video.data}`,
      })
    } else if (content.type === 'tool_call') {
      // Handle tool call content items - direct conversion from flat structure
      // Use AI SDK v5 UIToolInvocation format: toolCallId, state: 'output-available'/'input-available'
      // A call that failed, was denied or was stopped has no output; its error
      // is kept beside the content (see `toolErrorsOf`) so it reloads as an
      // error and not as a call that is still running.
      const errorText = (
        threadMessage.metadata as
          | { toolErrors?: Record<string, string> }
          | undefined
      )?.toolErrors?.[content.tool_call_id ?? '']
      if (content.output != null) {
        parts.push({
          type: `tool-${content.tool_name}`,
          toolCallId: content.tool_call_id,
          input: content.input,
          state: 'output-available',
          output: content.output,
        })
      } else if (errorText) {
        parts.push({
          type: `tool-${content.tool_name}`,
          toolCallId: content.tool_call_id,
          input: content.input,
          state: 'output-error',
          errorText,
        })
      } else {
        parts.push({
          type: `tool-${content.tool_name}`,
          toolCallId: content.tool_call_id,
          input: content.input,
          state: 'input-available',
        })
      }
    }
  }

  // BACKWARD COMPATIBILITY: Handle tool calls from metadata (old format)
  // New messages will have tool calls as separate messages with tool_call_id
  const toolCalls = (threadMessage.metadata as any)?.tool_calls
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      // Parse the result from the response.content array
      let result
      if (tc.response?.content) {
        // Extract content from the response
        if (tc.response.content.length === 1 && tc.response.content[0].type === 'text') {
          // Single text content - return as string
          result = tc.response.content[0].text
        } else {
          // Multiple content parts or non-text - return full content array
          result = tc.response.content
        }
      }

      const toolName = tc.tool?.function?.name || tc.name
      let toolInput: unknown
      if (typeof tc.tool?.function?.arguments === 'string') {
        try {
          toolInput = JSON.parse(tc.tool.function.arguments)
        } catch (error) {
          console.warn('Failed to parse tool call arguments; using raw string:', error)
          toolInput = tc.tool.function.arguments
        }
      } else {
        toolInput = tc.tool?.function?.arguments || tc.args
      }
      const toolCallId = tc.tool?.id || tc.id

      // Use AI SDK v5 UIToolInvocation format
      if (result != null || tc.state === 'ready' || tc.state === 'completed' || tc.state === 'result') {
        parts.push({
          type: `tool-${toolName}`,
          toolCallId,
          input: toolInput,
          state: 'output-available',
          output: result,
        })
      } else {
        parts.push({
          type: `tool-${toolName}`,
          toolCallId,
          input: toolInput,
          state: 'input-available',
        })
      }
    }
  }

  // Ensure at least one text part exists
  if (parts.length === 0) {
    parts.push({
      type: 'text',
      text: '',
    })
  }

  return parts
}

export function uiMessageHasMeaningfulContent(message: {
  parts?: any[]
}): boolean {
  if (!message.parts?.length) return false
  for (const part of message.parts) {
    if (!part || typeof part !== 'object') continue
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim())
      return true
    if (
      part.type === 'reasoning' &&
      ((typeof part.text === 'string' && part.text.trim()) ||
        (typeof part.reasoning === 'string' && part.reasoning.trim()))
    )
      return true
    if (part.type === 'file' && part.url) return true
    if (
      typeof part.type === 'string' &&
      part.type.startsWith('tool-') &&
      (part.input !== undefined || part.args !== undefined ||
        part.output !== undefined || part.result !== undefined)
    )
      return true
  }
  return false
}

export function threadMessageIsEmpty(message: ThreadMessage): boolean {
  if (message.role !== ChatCompletionRole.Assistant) return false
  const content = message.content || []
  if (content.length === 0) return true
  for (const c of content) {
    if (c.type === ContentType.Text || c.type === ContentType.Reasoning) {
      if (c.text?.value && c.text.value.trim()) return false
    } else if (c.type === ContentType.Image && c.image_url?.url) {
      return false
    } else if (c.type === ContentType.InputAudio && c.input_audio?.data) {
      return false
    } else if (c.type === ContentType.InputVideo && c.input_video?.data) {
      return false
    } else if (c.type === ContentType.ToolCall) {
      return false
    }
  }
  return true
}

/**
 * Convert an array of Jan's ThreadMessages to AI SDK UIMessage format.
 * Tool calls are now part of the content array, so no special merging is needed.
 */
export function convertThreadMessagesToUIMessages(
  threadMessages: ThreadMessage[]
): UIMessage[] {
  return threadMessages
    .map(convertThreadMessageToUIMessage)
    .filter((msg): msg is UIMessage => msg !== null)
}

/**
 * The error text of each tool call in `message` that ended in an error (failed,
 * denied, or stopped), by tool call id, for the message's persisted metadata.
 * Such a call has no output to store, so without this it reloads as a call that
 * never finished. Undefined when there is none.
 */
export function toolErrorsOf(
  message: UIMessage
): Record<string, string> | undefined {
  const errors: Record<string, string> = {}
  for (const part of (message.parts ?? []) as any[]) {
    if (
      typeof part?.type === 'string' &&
      part.type.startsWith('tool-') &&
      part.state === 'output-error' &&
      part.toolCallId &&
      part.errorText
    ) {
      errors[part.toolCallId] = part.errorText
    }
  }
  return Object.keys(errors).length > 0 ? errors : undefined
}

/**
 * Extract content from UIMessage parts as separate ThreadContent items.
 * This preserves the structure of multiple text/reasoning/tool call parts instead of combining them.
 *
 * @param message - The UIMessage to extract content from
 * @returns Array of ThreadContent items (including tool calls)
 */
export function extractContentPartsFromUIMessage(message: UIMessage): ThreadContent[] {
  const content: ThreadContent[] = []
  const parts = (message.parts ?? []) as any[]

  for (const part of parts) {
    if (part.type === 'reasoning') {
      // Add reasoning content as separate item
      const reasoningText = part.reasoning ?? part.text ?? ''
      if (reasoningText) {
        const reasoningContent = {
          type: 'reasoning' as ContentType.Reasoning,
          text: {
            value: reasoningText,
            annotations: [],
          },
        }
        content.push(reasoningContent)
      }
    } else if (part.type === 'text') {
      // Adapter notices are UI-only. `content` is replayed as assistant
      // history by old builds and the CLI (which never see providerMetadata),
      // so a notice must not enter it; its absence from `content` is what
      // makes uiParts the carrier that keeps displaying the notice.
      if (isChatRunNotice(part)) continue
      // Add text content as separate item
      const textContent = part.text ?? ''
      if (textContent) {
        content.push({
          type: 'text' as ContentType.Text,
          text: {
            value: textContent,
            annotations: [],
          },
        })
      }
    } else if (part.type === 'file' && part.mediaType) {
      const mediaType = part.mediaType as string
      if (mediaType?.startsWith('image/')) {
        content.push({
          type: 'image_url' as ContentType.Image,
          image_url: {
            url: part.url,
            detail: 'auto',
          },
        })
      } else if (mediaType === 'audio/wav' || mediaType === 'audio/mpeg') {
        const format = mediaType === 'audio/wav' ? 'wav' : 'mp3'
        const url = part.url as string | undefined
        const data =
          typeof url === 'string' && url.startsWith('data:')
            ? url.slice(url.indexOf(',') + 1)
            : (url ?? '')
        content.push({
          type: 'input_audio' as ContentType.InputAudio,
          input_audio: { data, format },
        })
      } else if (mediaType?.startsWith('video/')) {
        const url = part.url as string | undefined
        const data =
          typeof url === 'string' && url.startsWith('data:')
            ? url.slice(url.indexOf(',') + 1)
            : (url ?? '')
        content.push({
          type: 'input_video' as ContentType.InputVideo,
          input_video: { data, format: mediaType },
        })
      }
    } else if (part.type.startsWith('tool-')) {
      // Handle tool call parts - flatten structure to match parts format
      const toolName = (part.type as string).replace('tool-', '')
      const toolCallId = part.toolCallId || part.toolInvocationId
      const input = part.input || part.args
      const output = part.output || part.result

      const toolCallContent = {
        type: 'tool_call' as ContentType.ToolCall,
        tool_call_id: toolCallId,
        tool_name: toolName,
        input: input,
        output: output,
      }
      content.push(toolCallContent)
    }
  }

  // If no content was extracted, add empty text
  if (content.length === 0) {
    content.push({
      type: 'text' as ContentType.Text,
      text: {
        value: '',
        annotations: [],
      },
    })
  }

  return content
}

// The desktop UI's projection of a stored assistant turn; see
// `assistantRecordFields`.
type UIPartsSkipped = 'provider-metadata' | 'size' | 'unsupported-part' | 'mismatch'

const UI_PARTS_MAX_CHARS = 256 * 1024
const DIFF_PART_TYPE = 'data-tool-diff'
const TASK_STATUS_TYPE = 'data-task-status'

// Display-only status parts shed to fit the carrier; see `uiPartsFor`.
// Stored as `metadata.uiTaskStatusShed`, which is diagnostics only: it counts
// what was cut, and nothing reads it to decide how a turn is shown, rebuilt or
// sent to the model. It is not surfaced anywhere today, and no UI notice is
// promised for it later: a reader that finds it malformed ignores it.
type TaskStatusShed = { truncated?: number; stripped?: number; dropped?: number }

const isShedCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0

// The counts of a stored `uiTaskStatusShed`. Anything that is not a plain
// object (a string, array or null from an older or foreign writer) yields no
// counts, and a field that is not a finite non-negative integer is left out.
function priorTaskStatusShed(value: unknown): TaskStatusShed {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const prior = value as Record<string, unknown>
  const out: TaskStatusShed = {}
  for (const key of ['truncated', 'stripped', 'dropped'] as const)
    if (isShedCount(prior[key])) out[key] = prior[key]
  return out
}
const PROVIDER_METADATA_MAX_CHARS = 8 * 1024
const SETTLED_TOOL_STATES = new Set([
  'output-available',
  'output-error',
  'output-denied',
])

class SkipUIParts extends Error {
  constructor(readonly reason: UIPartsSkipped) {
    super(reason)
  }
}

// JSON with object keys sorted, so a comparison does not depend on key order:
// storage goes through serde_json::Value, which keeps insertion order only
// while some dependency enables its `preserve_order` feature (genai does today).
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]])
        )
      : v
  )
}

// Every field of each AI SDK UIMessagePart type (ai@6.0.182). A part carrying
// any other field is not stored (`unsupported-part`): an unknown field is never
// dropped silently, so a new SDK field fails loudly here instead.
const TOOL_FIELDS = [
  'type', 'toolCallId', 'title', 'toolMetadata', 'providerExecuted', 'state',
  'input', 'output', 'errorText', 'rawInput', 'callProviderMetadata',
  'resultProviderMetadata', 'preliminary', 'approval',
]
const PART_FIELDS: Record<string, readonly string[]> = {
  'text': ['type', 'text', 'state', 'providerMetadata'],
  'reasoning': ['type', 'text', 'state', 'providerMetadata'],
  'step-start': ['type'],
  'file': ['type', 'mediaType', 'filename', 'url', 'providerMetadata'],
  'source-url': ['type', 'sourceId', 'url', 'title', 'providerMetadata'],
  'source-document': ['type', 'sourceId', 'mediaType', 'title', 'filename', 'providerMetadata'],
  // `rawInput` is set on dynamic tools by the SDK runtime though its type omits it.
  'dynamic-tool': ['toolName', ...TOOL_FIELDS],
  'data-tool-diff': ['type', 'id', 'data'],
  // Chat `task` dispatch/completion status (chatRunTransport TASK_STATUS_PART).
  // The only `data-*` kind Jan writes; any other still reloads lossy (visibly,
  // as `unsupported-part`). convertToModelMessages drops data parts, so the
  // model never sees it.
  'data-task-status': ['type', 'id', 'data'],
  // Pings a Chat run drained mid-run (chatRunContext RUN_CONTEXT_PART); bounded
  // and shape-checked in sanitizeUIPart, expanded to user turns on reload.
  'data-run-context': ['type', 'id', 'data'],
}
const APPROVAL_FIELDS = ['id', 'approved', 'reason']
// Opaque provider/tool metadata objects: bounded, and plain JSON objects only.
const METADATA_FIELDS = new Set([
  'providerMetadata', 'callProviderMetadata', 'resultProviderMetadata', 'toolMetadata',
])
// Fields a call that has not settled does not keep (see sanitizeUIPart).
const SETTLED_ONLY_FIELDS = [
  'output', 'errorText', 'rawInput', 'resultProviderMetadata', 'preliminary', 'approval',
]

function providerField(value: unknown): unknown {
  if (value === undefined) return value
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SkipUIParts('unsupported-part')
  let size: number
  try {
    size = JSON.stringify(value)?.length ?? 0
  } catch {
    // BigInt, a cycle, a throwing getter: not plain JSON, so not storable.
    throw new SkipUIParts('unsupported-part')
  }
  if (size > PROVIDER_METADATA_MAX_CHARS) throw new SkipUIParts('provider-metadata')
  return value
}

function sanitizeUIPart(part: any): Record<string, unknown> {
  const type = part?.type
  if (type === TASK_STATUS_TYPE) {
    // Shaped (allowlisted row keys, bounded ids/text); idempotent on a stored part.
    part = shapeTaskStatusPart(part)
    if (!part) throw new SkipUIParts('unsupported-part')
  }
  if (type === 'data-tool-diff') {
    const data = part.data
    if (
      !data || typeof data !== 'object' ||
      Object.keys(data).some((k) => k !== 'toolCallId' && k !== 'diff') ||
      typeof data.toolCallId !== 'string' ||
      typeof data.diff !== 'string' ||
      data.diff.length > TOOL_DIFF_MAX_CHARS
    )
      throw new SkipUIParts('unsupported-part')
  }
  if (type === 'data-run-context' && !isRunContextData(part.data))
    throw new SkipUIParts('unsupported-part')
  const fields =
    typeof type === 'string' && type.startsWith('tool-') ? TOOL_FIELDS : PART_FIELDS[type]
  if (!fields) throw new SkipUIParts('unsupported-part')
  for (const key of Object.keys(part))
    if (part[key] !== undefined && !fields.includes(key))
      throw new SkipUIParts('unsupported-part')
  const isTool = fields === TOOL_FIELDS || type === 'dynamic-tool'
  // A call still in flight is stored as `input-available`, as reloading from
  // `content` has always done: onFinish runs it and rewrites the turn. It keeps
  // none of a settled call's fields.
  const settled = !isTool || SETTLED_TOOL_STATES.has(part.state)
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (!settled && SETTLED_ONLY_FIELDS.includes(field)) continue
    out[field] = METADATA_FIELDS.has(field) ? providerField(part[field]) : part[field]
  }
  if (!isTool) return out
  if (!settled) {
    out.state = 'input-available'
    return out
  }
  const approval = part.approval
  if (approval !== undefined) {
    if (
      !approval ||
      typeof approval !== 'object' ||
      typeof approval.id !== 'string' ||
      Object.keys(approval).some(
        (k) => approval[k] !== undefined && !APPROVAL_FIELDS.includes(k)
      )
    )
      throw new SkipUIParts('unsupported-part')
    out.approval = { id: approval.id, approved: approval.approved, reason: approval.reason }
  } else if (part.state === 'output-denied') {
    // convertToModelMessages dereferences the approval of a denied call, so a
    // denied call without one could never be re-sent.
    throw new SkipUIParts('unsupported-part')
  }
  return out
}

// The parts as plain JSON, each reduced to its type's allowlisted fields.
// Throws SkipUIParts rather than dropping anything that does not fit.
function sanitizeUIParts(parts: unknown[]): Record<string, unknown>[] {
  const sanitized = parts.map(sanitizeUIPart)
  // A diff is only valid next to the settled tool call it belongs to, so the
  // carrier cannot hold arbitrary data.
  const settledCalls = new Set(
    sanitized
      .filter((p) => typeof p.type === 'string' && (p.type.startsWith('tool-') || p.type === 'dynamic-tool') && SETTLED_TOOL_STATES.has(p.state as string))
      .map((p) => p.toolCallId)
  )
  for (const p of sanitized)
    if (p.type === 'data-tool-diff' && !settledCalls.has((p.data as { toolCallId: string }).toolCallId))
      throw new SkipUIParts('unsupported-part')
  try {
    return JSON.parse(JSON.stringify(sanitized))
  } catch {
    throw new SkipUIParts('unsupported-part')
  }
}

// The data URL of the media at `content[index]`, as a file part of
// `mediaType` carries it.
function contentMediaUrl(
  content: any[],
  index: unknown,
  mediaType: unknown
): string | undefined {
  if (!Number.isInteger(index) || typeof mediaType !== 'string') return undefined
  const c = content[index as number]
  if (c?.type === 'image_url' && typeof c.image_url?.url === 'string')
    return c.image_url.url
  const data = c?.type === 'input_audio' ? c.input_audio?.data
    : c?.type === 'input_video' ? c.input_video?.data
      : undefined
  return typeof data === 'string' ? `data:${mediaType};base64,${data}` : undefined
}

// The `content` tool_call entry for a tool part's call id.
function contentToolCall(content: any[], toolCallId: unknown): any {
  return content.find(
    (c) => c?.type === 'tool_call' && c.tool_call_id === toolCallId
  )
}

// A stored part with what it points at in `content` filled back in: a data
// URL (`contentRef`) or a tool output (`outputInContent`). Throws when the
// pointer does not resolve.
function resolveContentPointers(part: unknown, content: any[]): unknown {
  if (!part || typeof part !== 'object') return part
  const { contentRef, outputInContent, ...rest } = part as Record<string, unknown>
  if (contentRef !== undefined) {
    const url = contentMediaUrl(content, contentRef, rest.mediaType)
    if (url === undefined) throw new SkipUIParts('unsupported-part')
    rest.url = url
  }
  if (outputInContent !== undefined) {
    const entry = contentToolCall(content, rest.toolCallId)
    if (outputInContent !== true || !entry || entry.output === undefined)
      throw new SkipUIParts('unsupported-part')
    rest.output = entry.output
  }
  return rest
}

// Task-status parts are display-only and optional. Only a malformed one is
// filtered out (and counted); every other part, canonical or run-context, is
// left for the strict sanitize, which still fails closed on its own malformed
// parts. Used by the writer (uiPartsFor) and the reader (rehydrateUIParts),
// the reader before pointers resolve, so a stray pointer on a status part
// cannot fail the whole carrier.
function filterTaskStatusParts<T>(parts: T[]): { parts: T[]; dropped: number } {
  let dropped = 0
  const kept = parts.flatMap((part) => {
    if ((part as { type?: unknown } | null)?.type !== TASK_STATUS_TYPE) return [part]
    const shaped = shapeTaskStatusPart(part)
    if (shaped) return [shaped as unknown as T]
    dropped += 1
    return []
  })
  return { parts: kept, dropped }
}

// The stored parts, when the carrier is intact and re-deriving the record's
// `content` and `metadata.toolErrors` from them gives back exactly what is
// stored: any writer that changed either since (an older build's Stop rewrite,
// which may touch only `toolErrors`, or an edit) invalidates them.
function rehydrateUIParts(
  carrier: unknown,
  content: ThreadContent[],
  toolErrors: unknown
): { parts: Record<string, unknown>[]; dropped: number } | undefined {
  const { v, parts } = (carrier ?? {}) as { v?: unknown; parts?: unknown }
  if (v !== 1 || !Array.isArray(parts) || parts.length === 0) return undefined
  try {
    const filtered = filterTaskStatusParts(parts)
    const rehydrated = sanitizeUIParts(
      filtered.parts.map((part) => resolveContentPointers(part, content))
    )
    const derived = extractContentPartsFromUIMessage({
      parts: rehydrated,
    } as unknown as UIMessage)
    const derivedErrors = toolErrorsOf({ parts: rehydrated } as unknown as UIMessage)
    return canonicalJson(derived) === canonicalJson(content) &&
      canonicalJson(derivedErrors ?? {}) === canonicalJson(toolErrors ?? {})
      ? { parts: rehydrated, dropped: filtered.dropped }
      : undefined
  } catch {
    return undefined
  }
}

// The form a part is stored in: the two large payloads `content` already
// holds are kept once (a media data URL and a tool output), and the part
// points at them instead. Any other part is stored as is.
function storedPart(
  part: Record<string, unknown>,
  content: ThreadContent[]
): Record<string, unknown> {
  if (part.type === 'file' && typeof part.url === 'string' && part.url.startsWith('data:')) {
    const ref = content.findIndex(
      (_, i) => contentMediaUrl(content, i, part.mediaType) === part.url
    )
    if (ref < 0) return part
    const stored: Record<string, unknown> = { ...part, contentRef: ref }
    delete stored.url
    return stored
  }
  if (part.state === 'output-available' && part.output !== undefined) {
    const entry = contentToolCall(content, part.toolCallId)
    if (!entry || canonicalJson(entry.output) !== canonicalJson(part.output)) return part
    const stored: Record<string, unknown> = { ...part, outputInContent: true }
    delete stored.output
    return stored
  }
  return part
}

function uiPartsFor(
  message: UIMessage,
  content: ThreadContent[],
  metadata: Record<string, unknown>
): {
  uiParts?: { v: 1; parts: unknown[] }
  uiPartsSkipped?: UIPartsSkipped
  uiDiffsOmitted?: number
  uiTaskStatusShed?: TaskStatusShed
} {
  if (!message.parts?.length) return {}
  const shed: TaskStatusShed = {}
  try {
    // Task-status rows are display-only and optional: a malformed part is
    // dropped (and counted) instead of costing the turn its whole carrier.
    const { parts: prepared, dropped } = filterTaskStatusParts(message.parts)
    if (dropped) shed.dropped = dropped
    const sanitized = sanitizeUIParts(prepared)
    const legacy = sanitizeUIParts(
      contentToUIParts({ ...message, content, metadata } as unknown as ThreadMessage)
    )
    const legacyJson = canonicalJson(legacy)
    // Display-only diffs and task-status rows are optional: when they push the
    // carrier over its budget they are shed one step at a time, so they can
    // never turn a turn that would otherwise store its canonical and
    // model-visible parts (run-context pings, reasoning, tool parts) into a
    // lossy one. Order: cut the largest status text, drop the largest diff, strip
    // status text entirely, and only then drop a status part (identity and
    // timestamps are kept as long as possible).
    //
    // Each part's stored form and its exact JSON length are computed once, and
    // the carrier's total length is kept as a running sum (wrapper + parts +
    // commas), so shedding never re-serializes or re-scans the whole carrier.
    type Entry = {
      original: Record<string, unknown>
      stored: Record<string, unknown>
      size: number
      active: boolean
    }
    const entries: Entry[] = sanitized.map((original) => {
      const stored = storedPart(original, content)
      return { original, stored, size: JSON.stringify(stored).length, active: true }
    })
    const isShed = (e: Entry) => e.original.type === TASK_STATUS_TYPE || e.original.type === DIFF_PART_TYPE
    const wrapper = JSON.stringify({ v: 1, parts: [] }).length
    const totalOf = (list: Entry[]) =>
      wrapper + list.reduce((sum, e) => sum + e.size, 0) + Math.max(0, list.length - 1)
    let total = totalOf(entries)
    let activeCount = entries.length
    const fits = () => total <= UI_PARTS_MAX_CHARS

    // Parts that are never shed must fit on their own: fail early instead of
    // shedding everything first. (If they are exactly the canonical parts, no
    // carrier is needed at all, so that case is left to the final comparison.)
    const fixed = entries.filter((e) => !isShed(e))
    if (totalOf(fixed) > UI_PARTS_MAX_CHARS &&
      canonicalJson(fixed.map((e) => e.original)) !== legacyJson)
      throw new SkipUIParts('size')

    const shrink = (entry: Entry, to: Record<string, unknown> | undefined) => {
      if (to) {
        const stored = storedPart(to, content)
        const size = JSON.stringify(stored).length
        total += size - entry.size
        Object.assign(entry, { original: to, stored, size })
      } else {
        total -= entry.size + (activeCount > 1 ? 1 : 0)
        activeCount--
        entry.active = false
      }
    }
    // One pass per tier over candidates sorted once, largest first (ties keep
    // part order), stopping as soon as the carrier fits.
    const runTier = (candidates: Entry[], apply: (entry: Entry) => void) => {
      for (const entry of [...candidates].sort((a, b) => b.size - a.size)) {
        if (fits()) return
        apply(entry)
      }
    }
    const isStatus = (e: Entry) => e.original.type === TASK_STATUS_TYPE
    const hasLongText = (e: Entry) =>
      isStatus(e) &&
      (e.original.data as { subagents: Record<string, unknown>[] }).subagents.some((row) =>
        [row.finalOutput, row.error].some(
          (v) => typeof v === 'string' && v.length > TASK_STATUS_CARRIER_TEXT_LIMIT
        )
      )
    let omitted = 0
    if (!fits()) {
      runTier(entries.filter(hasLongText), (e) => {
        shrink(e, truncateTaskStatusPart(e.original))
        shed.truncated = (shed.truncated ?? 0) + 1
      })
    }
    if (!fits()) {
      runTier(entries.filter((e) => e.original.type === DIFF_PART_TYPE), (e) => {
        shrink(e, undefined)
        omitted++
      })
    }
    if (!fits()) {
      runTier(entries.filter((e) => e.active && isStatus(e) && taskStatusHasBulk(e.original)), (e) => {
        shrink(e, stripTaskStatusPart(e.original))
        shed.stripped = (shed.stripped ?? 0) + 1
      })
    }
    if (!fits()) {
      runTier(entries.filter((e) => e.active && isStatus(e)), (e) => {
        shrink(e, undefined)
        shed.dropped = (shed.dropped ?? 0) + 1
      })
    }

    // The carrier is built once, from what is left.
    const active = entries.filter((e) => e.active)
    let uiParts: { v: 1; parts: unknown[] } | undefined
    if (canonicalJson(active.map((e) => e.original)) !== legacyJson) {
      uiParts = { v: 1 as const, parts: active.map((e) => e.stored) }
      if (JSON.stringify(uiParts).length > UI_PARTS_MAX_CHARS) throw new SkipUIParts('size')
      // Never store a carrier the reader would reject (e.g. a call still in
      // flight that already has an output, which `content` keeps).
      if (!rehydrateUIParts(uiParts, content, metadata.toolErrors))
        throw new SkipUIParts('mismatch')
    }
    return {
      ...(uiParts ? { uiParts } : {}),
      ...(omitted ? { uiDiffsOmitted: omitted } : {}),
      ...(Object.keys(shed).length ? { uiTaskStatusShed: shed } : {}),
    }
  } catch (error) {
    // The carrier is optional: whatever goes wrong building it, the turn is
    // still saved (legacy content), never lost.
    const reason = error instanceof SkipUIParts ? error.reason : 'unsupported-part'
    console.warn(
      `Assistant turn ${message.id} will reload from content only (lossy): ${reason}`,
      ...(error instanceof SkipUIParts ? [] : [error])
    )
    return { uiPartsSkipped: reason }
  }
}

/**
 * The stored `content` and `metadata` of an assistant turn: the one builder
 * for both places a turn is written (onFinish and rewriteStoredTurn).
 *
 * `metadata.uiParts = { v: 1, parts }` is the desktop UI's projection of the
 * turn: its UIMessage parts, sanitized to plain JSON, so the turn reloads (and
 * is re-sent to the model) exactly as it streamed. It is written only when
 * reloading from `content` alone would lose something. A data URL already in
 * `content` is stored as `contentRef: <index>`, and a tool output `content`
 * already holds for the same call id as `outputInContent: true`, instead of a
 * second copy (text and reasoning are duplicated: they are small).
 * When the parts cannot be stored whole (oversized provider metadata, over
 * 256 KB, an unsupported part), `uiParts` is omitted and
 * `metadata.uiPartsSkipped` says why; nothing is silently truncated.
 *
 * Reading: `content` stays the canonical record. Older builds and the CLI read
 * only `content` and ignore these fields. A new build uses `uiParts` only while
 * re-deriving `content` from it gives back the stored `content`, and otherwise
 * (including every record written before this field existed) reloads from
 * `content` as before. Existing records are not migrated or rewritten.
 *
 * Trust: like `content`, the carrier is the user's own local data and is
 * re-sent to the model, including provider metadata (as provider options) and
 * `providerExecuted`. It grants nothing `content` could not already say.
 *
 * Display-only `data-tool-diff` parts are the exception to "whole or nothing":
 * when they alone exceed the budget the largest are dropped and
 * `metadata.uiDiffsOmitted` counts them; canonical parts are kept.
 * `data-task-status` rows are display-only too: they are shape-validated, and
 * over budget their text is cut, then stripped, then (last) the part dropped,
 * with `metadata.uiTaskStatusShed = { truncated?, stripped?, dropped? }` counting
 * parts. Run-context pings and reasoning/tool parts are never shed for them.
 *
 * `baseMetadata` is spread first, minus any `uiParts` / `uiPartsSkipped` it
 * carries from an earlier version of the turn.
 */
export function assistantRecordFields(
  message: UIMessage,
  baseMetadata: Record<string, unknown> | undefined,
  opts: { stopped?: boolean }
): { content: ThreadContent[]; metadata: Record<string, unknown> } {
  const content = extractContentPartsFromUIMessage(message)
  const toolErrors = toolErrorsOf(message)
  const metadata: Record<string, unknown> = {
    ...baseMetadata,
    ...(opts.stopped ? { stopped: true } : {}),
    ...(toolErrors ? { toolErrors } : {}),
  }
  delete metadata.uiParts
  delete metadata.uiPartsSkipped
  delete metadata.uiDiffsOmitted
  delete metadata.uiTaskStatusShed
  return {
    content,
    metadata: { ...metadata, ...uiPartsFor(message, content, metadata) },
  }
}
