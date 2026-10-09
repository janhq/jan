// A tool result carrying an image (`read` of an image file, `screenshot`) goes
// to the model as a `role: tool` message whose content is an array of a text
// part plus OpenAI `image_url` parts, the shape the CLI loop sends. The AI SDK
// cannot produce that: `@ai-sdk/openai-compatible` stringifies every
// structured tool output. So, as with audio and video attachments, the image
// rides inside the tool part's output text as a sentinel and the request fetch
// decodes it back into content parts.

import type { UIMessage } from '@ai-sdk/react'
import type { ModelMessage } from 'ai'

const PREFIX = ' __JAN_TOOL_IMAGE__'
const SUFFIX = ' '

const SENTINEL_REGEX =
  / __JAN_TOOL_IMAGE__(data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+) /g

const DATA_URL_REGEX = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/

type ToolResultContentItem =
  | { type: 'text'; text: string }
  | { type: 'image-data'; mediaType: string; data: string }

export function encodeToolImageSentinel(dataUrl: string): string {
  return `${PREFIX}${dataUrl}${SUFFIX}`
}

export function hasToolImageSentinel(text: string): boolean {
  return text.includes(PREFIX)
}

export type ImageUrlPart = {
  type: 'image_url'
  image_url: { url: string; detail: 'auto' }
}

/**
 * Splits a sentinel-bearing string into ordered OpenAI content parts. Returns
 * null when no sentinel is present so callers keep the string form.
 */
export function splitToolImageSentinels(
  text: string
): Array<{ type: 'text'; text: string } | ImageUrlPart> | null {
  if (!hasToolImageSentinel(text)) return null
  const parts: Array<{ type: 'text'; text: string } | ImageUrlPart> = []
  let lastIndex = 0
  SENTINEL_REGEX.lastIndex = 0
  for (
    let m = SENTINEL_REGEX.exec(text);
    m !== null;
    m = SENTINEL_REGEX.exec(text)
  ) {
    const [match, url] = m
    if (m.index > lastIndex) {
      parts.push({ type: 'text', text: text.slice(lastIndex, m.index) })
    }
    parts.push({ type: 'image_url', image_url: { url, detail: 'auto' } })
    lastIndex = m.index + match.length
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', text: text.slice(lastIndex) })
  }
  return parts
}

/** Removes every sentinel, leaving `replacement` in its place. */
export function stripToolImageSentinels(
  text: string,
  replacement: string
): string {
  if (!hasToolImageSentinel(text)) return text
  SENTINEL_REGEX.lastIndex = 0
  return text.replace(SENTINEL_REGEX, replacement)
}

type McpContentItem = {
  type?: string
  text?: string
  data?: string
  mimeType?: string
}

/** The content array of an MCP result, stored bare or as `{ content }`. */
function mcpContentItems(output: unknown): McpContentItem[] | null {
  if (Array.isArray(output)) return output
  if (output && typeof output === 'object') {
    const content = (output as { content?: unknown }).content
    if (Array.isArray(content)) return content
  }
  return null
}

function isMcpImage(
  item: McpContentItem | null | undefined
): item is McpContentItem & { data: string } {
  return item?.type === 'image' && typeof item.data === 'string' && !!item.data
}

function mcpImageDataUrl(item: McpContentItem & { data: string }): string {
  // The sentinel regex takes a lowercase media type and an unbroken base64
  // run, so normalise both: some servers wrap long base64 across lines.
  const data = item.data.replace(/\s+/g, '')
  if (data.startsWith('data:')) return data
  const mime = item.mimeType?.toLowerCase().startsWith('image/')
    ? item.mimeType.toLowerCase()
    : 'image/png'
  return `data:${mime};base64,${data}`
}

function mcpOutputWithSentinels(items: McpContentItem[]): string {
  const text: string[] = []
  const images: string[] = []
  for (const item of items) {
    if (isMcpImage(item)) images.push(mcpImageDataUrl(item))
    else if (item?.type === 'text' && typeof item.text === 'string')
      text.push(item.text)
    else text.push(JSON.stringify(item))
  }
  const head =
    text.join('\n') ||
    `The tool returned ${images.length} image${images.length === 1 ? '' : 's'}.`
  return head + images.map(encodeToolImageSentinel).join('')
}

/**
 * Re-encodes MCP tool results that carry images (e.g. the filesystem server's
 * `read_media_file`) so the model sees the image, not its base64.
 *
 * Chat stores an MCP result as its raw content array, which keeps the tool
 * card's image preview working. But the AI SDK stringifies structured tool
 * output, so sent as-is an image item reaches the model as megabytes of base64
 * text: useless to the model, and enough to blow a provider's input limit. An
 * output with at least one image item becomes its text plus one sentinel per
 * image instead, the same form Cowork's tool images take, so the request fetch
 * decodes it into `image_url` parts and `stripUnsupportedImageParts` drops it
 * for a model without vision. Text-only results are left as they are.
 */
export function encodeMcpToolImages(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.parts)) {
      return message
    }
    let touched = false
    const parts = message.parts.map((part) => {
      const type = (part as { type?: string }).type
      if (type !== 'dynamic-tool' && !type?.startsWith('tool-')) return part
      const items = mcpContentItems((part as { output?: unknown }).output)
      if (!items?.some(isMcpImage)) return part
      touched = true
      return { ...part, output: mcpOutputWithSentinels(items) } as typeof part
    })
    return touched ? ({ ...message, parts } as UIMessage) : message
  })
}

/**
 * For providers whose SDK builds its own request shape (Anthropic, Gemini,
 * OpenAI Responses), where the request fetch cannot decode a sentinel: hands
 * the SDK each tool image as a structured `content` output, which it maps to
 * the provider's native image block. Run on model messages, after
 * `convertToModelMessages` has stringified the UI tool output.
 */
export function toContentToolOutputs(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== 'tool') return message
    let touched = false
    const content = message.content.map((part) => {
      if (
        part.type !== 'tool-result' ||
        part.output.type !== 'text' ||
        !hasToolImageSentinel(part.output.value)
      ) {
        return part
      }
      const value = (splitToolImageSentinels(part.output.value) ?? []).flatMap(
        (item): ToolResultContentItem[] => {
          if (item.type === 'text') return [item]
          const match = DATA_URL_REGEX.exec(item.image_url.url)
          return match
            ? [{ type: 'image-data', mediaType: match[1], data: match[2] }]
            : []
        }
      )
      touched = true
      return { ...part, output: { type: 'content', value } } as typeof part
    })
    return touched ? { ...message, content } : message
  })
}
