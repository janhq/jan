import { generateText } from 'ai'
import { ModelFactory } from './model-factory'
import { useModelProvider } from '@/hooks/useModelProvider'

const MAX_TITLE_WORDS = 10
const MAX_PROMPT_LENGTH = 1500

function buildSummarizePrompt(transcript: string): string {
  const truncated =
    transcript.length > MAX_PROMPT_LENGTH
      ? transcript.slice(0, MAX_PROMPT_LENGTH) + '...'
      : transcript
  return `Summarize the following conversation into a concise title of at most ${MAX_TITLE_WORDS} words. Capture the overall topic, not just the latest turn. Output the title only, no quotes, no explanation.\n\nConversation:\n${truncated}`
}

/**
 * Clean a model-generated title: strip reasoning tags, special characters,
 * quotes, and enforce a word limit. Returns null if the result is unusable.
 */
export function cleanTitle(raw: string): string | null {
  let text = raw.trim()

  // Strip complete reasoning blocks like <think>...</think> (any tag name)
  text = text.replace(/<(think|thinking|reasoning|analysis)[^>]*>[\s\S]*?<\/\1>/gi, '').trim()

  // If a reasoning opener remains without a close, the output is all reasoning — unusable
  if (/<(think|thinking|reasoning|analysis)[^>]*>/i.test(text)) return null

  // If only a closing tag is present, take what's after the last one
  const lastClose = text.match(/<\/(?:think|thinking|reasoning|analysis)>\s*([\s\S]*)$/i)
  if (lastClose) {
    text = lastClose[1].trim()
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
  transcript: string,
  abortSignal: AbortSignal
): Promise<string | null> {
  try {
    const { selectedModel, selectedProvider, getProviderByName } =
      useModelProvider.getState()
    if (!selectedModel || !selectedProvider) {
      console.warn('[ThreadTitle] No model/provider selected')
      return null
    }

    // MLX models often emit reasoning that can't be reliably suppressed; fall back to default title.
    if (selectedProvider === 'mlx') return null

    const provider = getProviderByName(selectedProvider)
    if (!provider) {
      console.warn('[ThreadTitle] Provider not found:', selectedProvider)
      return null
    }

    console.log('[ThreadTitle] Creating model:', selectedModel.id, 'provider:', selectedProvider)
    const params: Record<string, unknown> =
      selectedProvider === 'llamacpp'
        ? { chat_template_kwargs: { enable_thinking: false } }
        : {}
    const model = await ModelFactory.createModel(
      selectedModel.id,
      provider,
      params
    )

    console.log('[ThreadTitle] Calling generateText...')
    const { text } = await generateText({
      model,
      messages: [{ role: 'user', content: buildSummarizePrompt(transcript) }],
      maxOutputTokens: 128,
      abortSignal,
    })

    console.log('[ThreadTitle] Raw response:', JSON.stringify(text))
    const cleaned = cleanTitle(text)
    console.log('[ThreadTitle] Cleaned title:', cleaned)
    return cleaned
  } catch (error) {
    // Silently swallow abort errors — this is expected when the user sends a new message
    if ((error as Error).name === 'AbortError') return null
    console.error('[ThreadTitle] Failed to generate title:', error)
    return null
  }
}
