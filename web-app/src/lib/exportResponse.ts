import { ThreadMessage } from '@janhq/core'
import { toPng } from 'html-to-image'

export type ExportFormat = 'markdown' | 'pdf' | 'image'

/**
 * Extracts thinking and response text from a message
 * Handles different thinking formats
 * Returns both thinkingText and responseText
 */
function extractThinkingAndResponse(message: ThreadMessage): {
  thinkingText?: string
  responseText: string
} {
  const text = message.content.find((e) => e.type === 'text')?.text?.value ?? ''

  // Check for incomplete thinking formats
  const hasThinkTag = text.includes('<think>') && !text.includes('</think>')
  const hasAnalysisChannel =
    text.includes('<|channel|>analysis<|message|>') &&
    !text.includes('<|start|>assistant<|channel|>final<|message|>')

  if (hasThinkTag || hasAnalysisChannel) {
    return { responseText: '', thinkingText: text }
  }

  // Check for completed think tag format
  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/)
  if (thinkMatch?.index !== undefined) {
    const splitIndex = thinkMatch.index + thinkMatch[0].length
    const thinkingContent = thinkMatch[1].trim()
    return {
      thinkingText: thinkingContent,
      responseText: text.slice(splitIndex).trim(),
    }
  }

  // Check for completed analysis channel format
  const analysisMatch = text.match(
    /<\|channel\|>analysis<\|message\|>([\s\S]*?)<\|start\|>assistant<\|channel\|>final<\|message\|>/
  )
  if (analysisMatch?.index !== undefined) {
    const splitIndex = analysisMatch.index + analysisMatch[0].length
    const thinkingContent = analysisMatch[1].trim()
    return {
      thinkingText: thinkingContent,
      responseText: text.slice(splitIndex).trim(),
    }
  }

  return { responseText: text, thinkingText: undefined }
}

/**
 * Formats the complete markdown content for PDF
 * Includes thinking section if specified
 */
function formatMarkdownContentForPdf(
  responseText: string,
  thinkingText?: string,
  includeThinking?: boolean
): string {
  let content = ''

  // Add thinking section if requested and available
  if (includeThinking && thinkingText && thinkingText.trim() !== '') {
    content += `<div style="font-size: 12px; color: #666; border-bottom: 2px solid #ccc; padding-bottom: 10px;">${thinkingText}</div>\n\n`
  }

  // Add assistant response section
  content += `${responseText}`

  return content
}

/**
 * Formats the complete markdown content for Markdown
 * Includes thinking section if specified
 */
function formatMarkdownContentForMarkdown(
  responseText: string,
  thinkingText?: string,
  includeThinking?: boolean
): string {
  let content = ''

  // Add thinking section if requested and available
  if (includeThinking && thinkingText && thinkingText.trim() !== '') {
    content += `# 🧠 Thinking\n${thinkingText}\n\n`
  }

  // Add assistant response section
  content += `# 🤖 Assistant\n${responseText}`

  return content
}

/**
 * Formats the complete markdown content for Image
 * Includes thinking section if specified
 */
function formatMarkdownContentForImage(
  responseText: string,
  thinkingText?: string,
  includeThinking?: boolean
): string {
  let content = ''

  // Add thinking section if requested and available
  if (includeThinking && thinkingText && thinkingText.trim() !== '') {
    content += `# 🧠 Thinking\n<div style="font-size: 12px; color: #666;">${thinkingText}</div>\n\n`
  }

  // Add assistant response section
  content += `# 🤖 Assistant\n${responseText}`

  return content
}

/**
 * Exports the message response as markdown
 * Optionally includes the thinking section
 * Returns the markdown content as a string
 */
export async function exportResponseAsMarkdown(
  message: ThreadMessage,
  includeThinking: boolean,
  format: 'markdown' | 'pdf' | 'image'
): Promise<string> {
  const { thinkingText, responseText } = extractThinkingAndResponse(message)

  let markdownContent = ''

  if (format === 'markdown') {
    markdownContent = formatMarkdownContentForMarkdown(
      responseText,
      thinkingText,
      includeThinking
    )
  } else if (format === 'pdf') {
    markdownContent = formatMarkdownContentForPdf(
      responseText,
      thinkingText,
      includeThinking
    )
  } else {
    markdownContent = formatMarkdownContentForImage(
      responseText,
      thinkingText,
      includeThinking
    )
  }

  return markdownContent
}

/**
 * Exports the message response as markdown file
 * Downloads the markdown content as a .md file
 * @param message - The thread message to export
 * @param includeThinking - Whether to include thinking process
 * @param filename - Optional filename for the export
 */
export async function downloadMarkdownFile(
  message: ThreadMessage,
  includeThinking: boolean,
  filename = `response-${new Date().toISOString().split('T')[0]}-${Math.random().toString(36).substring(2, 8)}`
): Promise<void> {
  const markdownContent = await exportResponseAsMarkdown(
    message,
    includeThinking,
    'markdown'
  )

  const element = document.createElement('a')
  const file = new Blob([markdownContent], { type: 'text/markdown' })
  element.href = URL.createObjectURL(file)
  element.download = filename
  document.body.appendChild(element)
  element.click()
  document.body.removeChild(element)
  URL.revokeObjectURL(element.href)
}

/**
 * Exports the message response as an image
 * Downloads the content as a .png file
 * @param element - The HTML element to capture
 * @param filename - Optional filename for the export
 */
export async function downloadImageFile(
  element: HTMLElement,
  filename = `response-${new Date().toISOString().split('T')[0]}-${Math.random().toString(36).substring(2, 8)}`
): Promise<void> {
  element.style.padding = '10px'
  element.style.color = '#000000'

  try {
    const dataUrl = await toPng(element, {
      quality: 1.0,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    })

    const link = document.createElement('a')
    link.download = filename
    link.href = dataUrl
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } catch (error) {
    console.error('Failed to generate image:', error)
    throw error
  }
}
