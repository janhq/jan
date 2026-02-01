export interface EnhancedPrompt {
  enhanced: string
  improvements: string[]
  reasoning: string
}

type ModelType =
  | 'gpt-4'
  | 'claude'
  | 'gemini'
  | 'llama'
  | 'mistral'
  | 'deepseek'

const MODEL_OPTIMIZATION_RULES: Record<
  ModelType,
  { tips: string[]; maxTokens: number }
> = {
  'deepseek': {
    tips: [
      'encode all data in <think> tags',
      'use structured and contextual format',
      'use proper addressing ',
    ],
    maxTokens: 4096,
  },

  'gpt-4': {
    tips: [
      'Use structured formats',
      'Be explicit about reasoning steps',
      'Leverage extended context',
    ],
    maxTokens: 8192,
  },
  'claude': {
    tips: [
      'Use XML tags for structure',
      'Request step-by-step thinking',
      'Provide clear constraints',
    ],
    maxTokens: 100000,
  },
  'gemini': {
    tips: [
      'Use markdown formatting',
      'Request detailed explanations',
      'Leverage multimodal context',
    ],
    maxTokens: 32000,
  },
  'llama': {
    tips: [
      'Keep prompts focused',
      'Use clear examples',
      'Avoid complex nested instructions',
    ],
    maxTokens: 4096,
  },
  'mistral': {
    tips: [
      'Be direct and specific',
      'Use bullet points',
      'Provide context upfront',
    ],
    maxTokens: 8192,
  },
}

function detectModelType(modelName: string): ModelType {
  const lower = modelName.toLowerCase()

  if (lower.includes('gpt-4') || lower.includes('gpt-3.5')) return 'gpt-4'
  if (lower.includes('claude')) return 'claude'
  if (lower.includes('gemini')) return 'gemini'
  if (lower.includes('llama')) return 'llama'
  if (lower.includes('mistral')) return 'mistral'

  return 'llama'
}

export function getModelOptimizationHints(modelName: string): string[] {
  const modelType = detectModelType(modelName)
  return (
    MODEL_OPTIMIZATION_RULES[modelType]?.tips ||
    MODEL_OPTIMIZATION_RULES.llama.tips
  )
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function validatePromptLength(
  prompt: string,
  modelName: string
): { valid: boolean; message?: string } {
  const modelType = detectModelType(modelName)
  const maxTokens = MODEL_OPTIMIZATION_RULES[modelType]?.maxTokens || 4096
  const estimatedTokens = estimateTokens(prompt)

  if (estimatedTokens > maxTokens * 0.8) {
    return {
      valid: false,
      message: `Prompt is ${estimatedTokens} tokens, approaching ${modelName} limit of ${maxTokens}`,
    }
  }

  return { valid: true }
}
