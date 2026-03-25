import { generateText } from 'ai'
import { ModelFactory } from './model-factory'
import { useModelProvider } from '@/hooks/useModelProvider'

const MAX_TITLE_WORDS = 10
const MAX_PROMPT_LENGTH = 500

function buildSummarizePrompt(message: string): string {
  const truncated =
    message.length > MAX_PROMPT_LENGTH
      ? message.slice(0, MAX_PROMPT_LENGTH) + '...'
      : message
  return `Summarize in a ${MAX_TITLE_WORDS}-word Title. Give the title only. Here is the message: "${truncated}"`
}

/**
 * Clean a model-generated title: strip reasoning tags, special characters,
 * quotes, and enforce a word limit. Returns null if the result is unusable.
 */
export function cleanTitle(raw: string): string | null {
  let text = raw.trim()

  // Strip reasoning blocks like <think>...</think>
  const thinkMatch = text.match(/<\/think>\s*(.*)$/s)
  if (thinkMatch) {
    text = thinkMatch[1].trim()
  }

  // Remove leftover XML-like tags
  text = text.replace(/<[^>]+>/g, '').trim()

  // Collapse whitespace and newlines into single spaces
  text = text.replace(/\s+/g, ' ').trim()

  // Remove surrounding quotes
  text = text.replace(/^["']+|["']+$/g, '').trim()

  // Keep only letters, numbers, and spaces (unicode-aware)
  text = text.replace(/[^\p{L}\p{N}\s]/gu, '').trim()

  // Enforce word limit
  const words = text.split(/\s+/).slice(0, MAX_TITLE_WORDS)
  text = words.join(' ')

  if (!text || text.length < 2) return null

  return text
}

/**
 * Generate a summarized thread title from the user's first message.
 * Uses the currently selected model via a non-streaming generateText call.
 * Returns null on failure or if the signal is aborted.
 */
export async function generateThreadTitle(
  firstMessage: string,
  abortSignal: AbortSignal
): Promise<string | null> {
  try {
    const { selectedModel, selectedProvider, getProviderByName } =
      useModelProvider.getState()
    if (!selectedModel || !selectedProvider) return null

    const provider = getProviderByName(selectedProvider)
    if (!provider) return null

    const model = await ModelFactory.createModel(selectedModel.id, provider, {})

    const { text } = await generateText({
      model,
      messages: [{ role: 'user', content: buildSummarizePrompt(firstMessage) }],
      abortSignal,
      maxOutputTokens: 50,
    })

    return cleanTitle(text)
  } catch (error) {
    // Silently swallow abort errors — this is expected when the user sends a new message
    if ((error as Error).name === 'AbortError') return null
    console.warn('[ThreadTitle] Failed to generate title:', error)
    return null
  }
}
