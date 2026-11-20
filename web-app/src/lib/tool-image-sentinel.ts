// A tool result carrying an image (`read` of an image file, `screenshot`) goes
// to the model as a `role: tool` message whose content is an array of a text
// part plus OpenAI `image_url` parts, the shape the CLI loop sends. The AI SDK
// cannot produce that: `@ai-sdk/openai-compatible` stringifies every
// structured tool output. So, as with audio and video attachments, the image
// rides inside the tool part's output text as a sentinel and the request fetch
// decodes it back into content parts.

import type { UIMessage } from '@ai-sdk/react'
import type { ModelMessage } from 'ai'

// What vision providers and llama.cpp's image loader accept. Anything else
// (svg, bmp, tiff) is rejected upstream, and since the stored result is
// re-sent on every turn it would break the thread for good.
const SENDABLE_IMAGE_TYPES: Record<string, true> = {
  'image/png': true,
  'image/jpeg': true,
  'image/gif': true,
  'image/webp': true,
}

// A tool result is attacker-controlled text: a fetched page, a file, an MCP
// server's reply or error. If the marker were a fixed string, any of them could
// carry one and have it decoded into an `image_url` part, with an svg or
// corrupt payload the upstream rejects. The result is stored and re-sent every
// turn, so that one result would break the thread for good. So the marker
// carries a per-process nonce that only this module knows: it never reaches a
// model (a sentinel is decoded or stripped before the request leaves), so a
// result cannot reproduce it. Sentinels are minted per request and never
// persisted; one left over from an earlier run no longer decodes, which is the
// same as any forged one: it stays plain text.
const NONCE = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) =>
  b.toString(16).padStart(2, '0')
).join('')
const PREFIX = ` __JAN_TOOL_IMAGE__${NONCE}:`
const SUFFIX = ' '

const SENTINEL_REGEX = new RegExp(
  `${PREFIX}(data:image/(?:${Object.keys(SENDABLE_IMAGE_TYPES)
    .map((type) => type.slice('image/'.length))
    .join('|')});base64,[A-Za-z0-9+/=]+)${SUFFIX}`,
  'g'
)

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

// Largest decoded image sent to a model. Anthropic's 5 MB per-image limit is
// the lowest of the providers; a larger one is rejected, and since the result
// is re-sent every turn, so is every later request.
const MAX_TOOL_IMAGE_BYTES = 5 * 1024 * 1024

/** The media type the leading bytes declare, or null when they are no sendable image. */
function sniffImageType(base64: string): string | null {
  let head: string
  try {
    head = atob(base64.slice(0, 16))
  } catch {
    return null
  }
  if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png'
  if (head.startsWith('\xff\xd8\xff')) return 'image/jpeg'
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp'
  return null
}

/**
 * One MCP image item as a data URL, or the reason it is not sent. The server
 * decides the bytes, so they are checked rather than trusted: a corrupt or
 * mislabelled image fails the whole request upstream.
 */
function mcpImage(
  item: McpContentItem & { data: string }
): { url: string } | { omitted: string } {
  // The sentinel regex takes a lowercase media type and an unbroken base64
  // run, so normalise both: some servers wrap long base64 across lines.
  const raw = item.data.replace(/\s+/g, '')
  const dataUrl = /^data:([^;,]*);base64,(.*)$/i.exec(raw)
  const payload = dataUrl ? dataUrl[2] : raw
  const declared = (
    dataUrl
      ? dataUrl[1]
      : item.mimeType?.toLowerCase().startsWith('image/')
        ? item.mimeType
        : 'image/png'
  ).toLowerCase()
  if (SENDABLE_IMAGE_TYPES[declared] !== true) {
    return { omitted: `${declared.slice(0, 64)} is not supported` }
  }
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  if (Math.floor((payload.length * 3) / 4) - padding > MAX_TOOL_IMAGE_BYTES) {
    return {
      omitted: `larger than ${MAX_TOOL_IMAGE_BYTES / (1024 * 1024)} MB`,
    }
  }
  const actual = /^[A-Za-z0-9+/]+={0,2}$/.test(payload)
    ? sniffImageType(payload)
    : null
  if (!actual) return { omitted: 'not a valid PNG, JPEG, GIF or WebP image' }
  // Label it with what the bytes are: a provider rejects a mismatched type.
  return { url: `data:${actual};base64,${payload}` }
}

function mcpOutputWithSentinels(items: McpContentItem[]): string {
  // Items keep their original order so a caption stays next to its image.
  const pieces: Array<{ text: boolean; value: string }> = []
  let images = 0
  for (const item of items) {
    if (isMcpImage(item)) {
      const image = mcpImage(item)
      if ('url' in image) {
        images++
        pieces.push({ text: false, value: encodeToolImageSentinel(image.url) })
      } else {
        pieces.push({ text: true, value: `(image omitted: ${image.omitted})` })
      }
    } else if (item?.type === 'text' && typeof item.text === 'string') {
      pieces.push({ text: true, value: item.text })
    } else {
      pieces.push({ text: true, value: JSON.stringify(item) })
    }
  }
  let out = ''
  let prevText = false
  for (const piece of pieces) {
    if (piece.text && prevText) out += '\n'
    out += piece.value
    prevText = piece.text
  }
  const hasText = pieces.some((piece) => piece.text)
  return hasText || images === 0
    ? out
    : `The tool returned ${images} image${images === 1 ? '' : 's'}.${out}`
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
