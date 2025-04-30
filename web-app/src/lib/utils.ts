import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getProviderLogo(provider: string) {
  switch (provider) {
    case 'llama.cpp':
      return '/images/model-provider/llamacpp.svg'
    case 'anthropic':
      return '/images/model-provider/anthropic.svg'
    case 'mistral':
      return '/images/model-provider/mistral.svg'
    case 'martian':
      return '/images/model-provider/martian.svg'
    case 'openrouter':
      return '/images/model-provider/openRouter.svg'
    case 'openai':
      return '/images/model-provider/openai.svg'
    case 'groq':
      return '/images/model-provider/groq.svg'
    case 'cohere':
      return '/images/model-provider/cohere.svg'
    case 'nvidia':
      return '/images/model-provider/nvidia.svg'
    case 'meta':
      return '/images/model-provider/meta.svg'
    case 'google':
      return '/images/model-provider/google.svg'
    case 'deepseek':
      return '/images/model-provider/deepseek.svg'
    default:
      return undefined
  }
}

export const getProviderTitle = (provider: string) => {
  switch (provider) {
    case 'llama.cpp':
      return 'Llama.cpp'
    case 'openai':
      return 'OpenAI'
    case 'openrouter':
      return 'OpenRouter'
    case 'google':
      return 'Google'
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1)
  }
}
