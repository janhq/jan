// A tool result carrying an image (`read` of an image file, `screenshot`) goes
// to the model as a `role: tool` message whose content is an array of a text
// part plus OpenAI `image_url` parts, the shape the CLI loop sends. The AI SDK
// cannot produce that: `@ai-sdk/openai-compatible` stringifies every
// structured tool output. So, as with audio and video attachments, the image
// rides inside the tool part's output text as a sentinel and the request fetch
// decodes it back into content parts.

const PREFIX = ' __JAN_TOOL_IMAGE__'
const SUFFIX = ' '

const SENTINEL_REGEX =
  / __JAN_TOOL_IMAGE__(data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+) /g

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
