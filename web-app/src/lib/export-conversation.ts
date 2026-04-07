import { ThreadMessage, ContentType } from '@janhq/core'
import { formatDate } from '@/utils/formatDate'

type ExportOptions = {
  threadTitle: string
  messages: ThreadMessage[]
  format: 'markdown' | 'json'
}

// Extracts reasoning from old-format <think> tags and returns separate segments
function splitThinkTags(text: string): { reasoning: string | null; body: string } {
  const match = text.match(/<think>([\s\S]*)<\/think>/)
  if (!match) return { reasoning: null, body: text }

  const reasoning = match[1].trim()
  const body = text.slice(match.index! + match[0].length).trim()
  return { reasoning: reasoning || null, body }
}

// Wraps reasoning text in a collapsible markdown block
function wrapReasoning(text: string): string {
  return `<details>\n<summary>Thinking</summary>\n\n${text}\n\n</details>`
}

// Checks whether a message has any visible text content outside of reasoning blocks
function hasTextContent(message: ThreadMessage): boolean {
  for (const content of message.content || []) {
    if (content.type === ContentType.Text) {
      const { body } = splitThinkTags(content.text?.value || '')
      if (body) return true
    }
  }
  return false
}

// Converts a single message's content array into a readable markdown string
function formatMessageContent(message: ThreadMessage): string {
  const parts: string[] = []

  // When a message only has reasoning and no separate text, the reasoning IS
  // the response — show it as plain text instead of hiding it in a collapsible block.
  const collapseReasoning = hasTextContent(message)

  for (const content of message.content || []) {
    switch (content.type) {
      case ContentType.Text: {
        if (!content.text?.value) break

        const { reasoning, body } = splitThinkTags(content.text.value)
        if (reasoning) {
          parts.push(collapseReasoning ? wrapReasoning(reasoning) : reasoning)
        }
        if (body) {
          parts.push(body)
        }
        break
      }

      case ContentType.Reasoning:
        if (content.text?.value) {
          parts.push(collapseReasoning ? wrapReasoning(content.text.value) : content.text.value)
        }
        break

      case ContentType.Image:
        if (content.image_url?.url) {
          parts.push(`![image](${content.image_url.url})`)
        }
        break

      case ContentType.ToolCall: {
        const name = content.tool_name || 'unknown'
        const lines: string[] = [`**Tool: ${name}**`]

        if (content.input) {
          try {
            const inputStr = typeof content.input === 'string'
              ? content.input
              : JSON.stringify(content.input, null, 2)
            lines.push(`\`\`\`json\n${inputStr}\n\`\`\``)
          } catch {
            lines.push(`Input: ${String(content.input)}`)
          }
        }

        if (content.output) {
          try {
            const outputStr = typeof content.output === 'string'
              ? content.output
              : JSON.stringify(content.output, null, 2)
            lines.push(`**Result:**\n${outputStr}`)
          } catch {
            lines.push(`Result: ${String(content.output)}`)
          }
        }

        parts.push(lines.join('\n'))
        break
      }
    }
  }

  return parts.join('\n\n')
}

// Maps message role to a display label for the markdown export
function getRoleLabel(role: string): string {
  switch (role) {
    case 'user':
      return 'You'
    case 'assistant':
      return 'Assistant'
    case 'system':
      return 'System'
    default:
      return role
  }
}

// Builds the full markdown document from thread title and messages
export function buildMarkdown({ threadTitle, messages }: ExportOptions): string {
  const lines: string[] = [
    `# ${threadTitle}`,
    '',
    `> Exported from Jan on ${formatDate(new Date(), { includeTime: true })}`,
    '',
    '---',
    '',
  ]

  for (const message of messages) {
    const label = getRoleLabel(message.role)
    const content = formatMessageContent(message)

    if (!content.trim()) continue

    const timestamp = message.created_at
      ? ` — ${formatDate(message.created_at, { includeTime: true })}`
      : ''
    lines.push(`### ${label}${timestamp}`)
    lines.push('')
    lines.push(content)
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

// Builds a JSON export with structured thread and message data
export function buildJson({ threadTitle, messages }: ExportOptions): string {
  return JSON.stringify({
    title: threadTitle,
    exported_at: new Date().toISOString(),
    messages: messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      created_at: msg.created_at,
      metadata: msg.metadata,
    })),
  }, null, 2)
}

// Triggers a file download in the browser using a Blob URL
function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()

  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// Sanitizes a title into a safe filename, preserving Unicode letters
export function toSafeFilename(title: string): string {
  // eslint-disable-next-line no-control-regex
  const unsafeChars = /[<>:"/\\|?*\x00-\x1f]/g
  const sanitized = title
    .replace(unsafeChars, '')
    .replace(/\s+/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '')

  if (sanitized.length === 0) return 'conversation'
  if (sanitized.length > 80) return sanitized.slice(0, 80)

  return sanitized
}

// Main entry point for exporting a conversation
export function exportConversation(options: ExportOptions): void {
  const { threadTitle, messages, format } = options

  if (messages.length === 0) return

  const baseName = toSafeFilename(threadTitle)

  switch (format) {
    case 'markdown': {
      const md = buildMarkdown(options)
      downloadFile(`${baseName}.md`, md, 'text/markdown;charset=utf-8')
      break
    }
    case 'json': {
      const json = buildJson(options)
      downloadFile(`${baseName}.json`, json, 'application/json;charset=utf-8')
      break
    }
  }
}

// Strips HTML tags from a thread title and returns a plain text fallback
export function cleanThreadTitle(rawTitle: string | undefined): string {
  return (rawTitle || '').replace(/<[^>]*>/g, '').trim() || 'Conversation'
}
