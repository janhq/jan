import { isPlainObject } from './toolInputSummary'

/**
 * A short, human description of what a tool returned, so a generic (MCP) result
 * leads with "3 text blocks, 1 image" or its first line rather than a wall of
 * JSON. Returns an i18n key plus its interpolation values; the raw payload stays
 * available behind a toggle.
 */
export type ToolOutputSummary = {
  key: string
  values?: Record<string, string | number>
}

const PREVIEW_MAX = 140
const ELLIPSIS = '...'

const firstLine = (text: string): string => {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) return ''
  return line.length > PREVIEW_MAX
    ? line.slice(0, PREVIEW_MAX - ELLIPSIS.length) + ELLIPSIS
    : line
}

type ContentItem = { type?: string; text?: string }

const isContentEnvelope = (
  value: unknown
): value is { content: ContentItem[] } =>
  isPlainObject(value) && Array.isArray(value.content)

export function summarizeToolOutput(
  output: unknown
): ToolOutputSummary | undefined {
  if (output === undefined || output === null) return undefined

  if (typeof output === 'string') {
    const preview = firstLine(output)
    return preview
      ? { key: 'tools:toolCall.summaryText', values: { preview } }
      : { key: 'tools:toolCall.summaryEmpty' }
  }

  // The MCP content envelope: a list of typed blocks.
  if (isContentEnvelope(output)) {
    const items = output.content
    const texts = items.filter((item) => item.type === 'text')
    const others = items.length - texts.length

    if (others > 0) {
      return {
        key: 'tools:toolCall.summaryBlocks',
        values: { text: texts.length, other: others },
      }
    }
    const joined = texts.map((item) => item.text ?? '').join('\n')
    const preview = firstLine(joined)
    if (preview) {
      return texts.length > 1
        ? {
            key: 'tools:toolCall.summaryTextBlocks',
            values: { count: texts.length, preview },
          }
        : { key: 'tools:toolCall.summaryText', values: { preview } }
    }
    return items.length === 0
      ? { key: 'tools:toolCall.summaryEmpty' }
      : { key: 'tools:toolCall.summaryBlocks', values: { text: texts.length, other: 0 } }
  }

  if (Array.isArray(output)) {
    return output.length === 0
      ? { key: 'tools:toolCall.summaryEmpty' }
      : { key: 'tools:toolCall.summaryItems', values: { count: output.length } }
  }

  if (isPlainObject(output)) {
    const keys = Object.keys(output)
    return keys.length === 0
      ? { key: 'tools:toolCall.summaryEmpty' }
      : {
          key: 'tools:toolCall.summaryFields',
          values: { count: keys.length, fields: keys.slice(0, 4).join(', ') },
        }
  }

  return { key: 'tools:toolCall.summaryText', values: { preview: String(output) } }
}
