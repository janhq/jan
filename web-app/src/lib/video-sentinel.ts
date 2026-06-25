// Video attachments enter the AI SDK as `file` parts with video mediaType,
// but `@ai-sdk/openai-compatible` rejects any non-image file part. To bypass
// that converter without forking the provider, we encode each video part as a
// text sentinel before `streamText` and decode it back into an llama-server
// `input_video` content part inside the request fetch. Mirrors audio-sentinel,
// but llama-server's `input_video` wire shape is `{ data }` with no format.

const PREFIX = ' __JAN_VIDEO__'
const SUFFIX = ' '

const SENTINEL_REGEX = / __JAN_VIDEO__([A-Za-z0-9+/=]+) /g

export function encodeVideoSentinel(base64: string): string {
  return `${PREFIX}${base64}${SUFFIX}`
}

export function hasVideoSentinel(text: string): boolean {
  return text.includes(PREFIX)
}

export type VideoPart = { type: 'input_video'; input_video: { data: string } }

// Splits a sentinel-bearing string into an ordered array of content parts.
// Returns null when no sentinel is present so callers can keep the original
// string form.
export function splitVideoSentinels(
  text: string
): Array<{ type: 'text'; text: string } | VideoPart> | null {
  if (!hasVideoSentinel(text)) return null
  const parts: Array<{ type: 'text'; text: string } | VideoPart> = []
  let lastIndex = 0
  SENTINEL_REGEX.lastIndex = 0
  for (let m = SENTINEL_REGEX.exec(text); m !== null; m = SENTINEL_REGEX.exec(text)) {
    const [match, data] = m
    if (m.index > lastIndex) {
      const chunk = text.slice(lastIndex, m.index)
      if (chunk.length > 0) parts.push({ type: 'text', text: chunk })
    }
    parts.push({ type: 'input_video', input_video: { data } })
    lastIndex = m.index + match.length
  }
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex)
    if (tail.length > 0) parts.push({ type: 'text', text: tail })
  }
  return parts
}

// Extracts the base64 payload from a `data:video/<x>;base64,...` URL.
// Returns null on shapes we don't recognise.
export function parseVideoDataUrl(url: string): { data: string } | null {
  const match = /^data:video\/[a-z0-9.+-]+;base64,(.+)$/i.exec(url)
  if (!match) return null
  return { data: match[1] }
}
