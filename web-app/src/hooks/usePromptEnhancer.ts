import { useState, useCallback } from 'react'
import { useThreads } from './useThreads'
import { useModelProvider } from './useModelProvider'
import { sendCompletion } from '@/lib/completion'
import { Thread } from '@janhq/core'
import { ChatCompletionMessageParam } from 'openai/resources'
import { toast } from 'sonner'

interface EnhancementOptions {
  originalPrompt: string
  targetModel?: string
  focus?: 'clarity' | 'detail' | 'conciseness' | 'creativity' | 'technical'
}

interface EnhancedPrompt {
  enhanced: string
  improvements: string[]
  reasoning?: string
}

const ENHANCEMENT_SYSTEM_PROMPT = `You are an expert prompt engineer. Your task is to enhance user prompts to get better AI responses.

Return ONLY a JSON object with this exact structure:
{
  "enhanced": "the improved prompt",
  "improvements": ["improvement 1", "improvement 2"],
  "reasoning": "brief explanation"
}

No other text before or after the JSON.`

const FOCUS_INSTRUCTIONS = {
  clarity: 'Make the prompt clearer and more specific. Remove ambiguity.',
  detail: 'Add relevant details, context, and expected output format.',
  conciseness: 'Make the prompt more concise while keeping essential meaning.',
  creativity: 'Enhance the prompt to encourage creative, innovative responses.',
  technical: 'Make the prompt technically precise with specific requirements.',
}

const MODEL_HINTS: Record<string, string[]> = {
  'gpt-4': ['Use structured formats', 'Be explicit about reasoning steps'],
  'claude': ['Use XML tags for structure', 'Request step-by-step thinking'],
  'gemini': ['Use markdown formatting', 'Request detailed explanations'],
  'llama': ['Keep prompts focused', 'Use clear examples'],
  'mistral': ['Be direct and specific', 'Use bullet points'],
  'deepseek': ['Encode reasoning in <think> tags', 'Use structured format'],
  'default': ['Be clear and specific', 'Provide context and examples'],
}

export function usePromptEnhancer() {
  const [isEnhancing, setIsEnhancing] = useState(false)
  const { getCurrentThread } = useThreads()
  const { getProviderByName, selectedProvider } = useModelProvider()

  const enhance = useCallback(
    async (options: EnhancementOptions): Promise<EnhancedPrompt> => {
      const { originalPrompt, targetModel, focus = 'clarity' } = options

      setIsEnhancing(true)

      try {
        const thread = getCurrentThread()
        const provider = getProviderByName(selectedProvider)

        if (!provider) {
          console.error('[Prompt Enhancer] No provider available')
          toast.error('Enhancement unavailable', {
            description:
              'No model provider configured. Please select a model first.',
          })
          throw new Error('No provider available')
        }

        if (!thread?.model) {
          console.error('[Prompt Enhancer] No active thread or model')
          toast.error('Enhancement unavailable', {
            description:
              'No active chat or model loaded. Start a conversation first.',
          })
          throw new Error('No active thread')
        }

        const modelType = detectModelType(targetModel || thread.model.id)
        const hints = MODEL_HINTS[modelType] || MODEL_HINTS.default
        const modelInfo = modelType !== 'default' ? ` (${modelType})` : ''

        const userPrompt = `Focus: ${FOCUS_INSTRUCTIONS[focus]}
${hints.length > 0 ? `\nOptimize for model${modelInfo}: ${hints.join(', ')}` : ''}

Original prompt:
"""${originalPrompt}"""

Enhance this prompt.`

        const messages: ChatCompletionMessageParam[] = [
          { role: 'system', content: ENHANCEMENT_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ]

        const abortController = new AbortController()
        let accumulatedContent = ''

        const response = await sendCompletion(
          thread as Thread,
          provider,
          messages,
          abortController,
          [],
          true,
          {}
        )

        if (response && Symbol.asyncIterator in response) {
          for await (const chunk of response as AsyncIterable<any>) {
            const content = chunk.choices?.[0]?.delta?.content
            if (content) {
              accumulatedContent += content
            }
          }
        }

        return parseEnhancementResponse(accumulatedContent)
      } catch (error) {
        console.error('[Prompt Enhancer] Enhancement failed:', error)
        if (
          error instanceof Error &&
          !error.message.includes('No provider') &&
          !error.message.includes('No active')
        ) {
          toast.error('Enhancement failed', {
            description: 'An error occurred while enhancing. Please try again.',
          })
        }
        throw error
      } finally {
        setIsEnhancing(false)
      }
    },
    [getCurrentThread, getProviderByName, selectedProvider]
  )

  return { enhance, isEnhancing }
}

function detectModelType(modelName: string): string {
  const lower = modelName.toLowerCase()
  if (lower.includes('gpt')) return 'gpt-4'
  if (lower.includes('claude')) return 'claude'
  if (lower.includes('gemini')) return 'gemini'
  if (lower.includes('llama')) return 'llama'
  if (lower.includes('mistral')) return 'mistral'
  if (lower.includes('deepseek')) return 'deepseek'
  return 'default'
}

function parseEnhancementResponse(response: string): EnhancedPrompt {
  try {
    const jsonMatch = response.match(/\{[\s\S]*?\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.enhanced && Array.isArray(parsed.improvements)) {
        return {
          enhanced: parsed.enhanced,
          improvements: parsed.improvements,
          reasoning: parsed.reasoning || 'AI-enhanced',
        }
      }
    }
  } catch (e) {
    console.warn('[Prompt Enhancer] Failed to parse JSON from response:', e)
  }

  if (
    response &&
    response.length > 20 &&
    !response.toLowerCase().includes('error')
  ) {
    console.warn('[Prompt Enhancer] Using raw response as enhancement')
    return {
      enhanced: response.trim(),
      improvements: ['Enhanced by AI'],
      reasoning: 'AI-generated enhancement',
    }
  }

  console.error('[Prompt Enhancer] Invalid response format')
  toast.error('Enhancement failed', {
    description: 'Model response was invalid. Please try again.',
  })
  throw new Error('Invalid enhancement response')
}
