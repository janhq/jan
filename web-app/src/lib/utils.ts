import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getProviderLogo(provider: string) {
  switch (provider) {
    case 'llamacpp':
      return 'images/model-provider/anthropic.svg'
    case 'anthropic':
      return 'images/model-provider/anthropic.svg'
    case 'mistral':
      return 'images/model-provider/mistral.svg'
    case 'martian':
      return 'images/model-provider/martian.svg'
    case 'openrouter':
      return 'images/model-provider/openRouter.svg'
    case 'openai':
      return 'images/model-provider/openai.svg'
    case 'groq':
      return 'images/model-provider/groq.svg'
    case 'triton_trtllm':
      return 'images/model-provider/triton_trtllm.svg'
    case 'cohere':
      return 'images/model-provider/cohere.svg'
    case 'nvidia':
      return 'images/model-provider/nvidia.svg'
    case 'meta':
      return 'images/model-provider/meta.svg'
    case 'google':
      return 'images/model-provider/google.svg'
    case 'deepseek':
      return 'images/model-provider/deepseek.svg'
    default:
      return undefined
  }
}
