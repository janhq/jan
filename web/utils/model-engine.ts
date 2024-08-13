import { LocalEngine, RemoteEngine } from '@janhq/core'

import { ModelHubCategory } from '@/hooks/useModelHub'

export const getTitleByCategory = (category: ModelHubCategory) => {
  if (!category || !category.length) return ''
  switch (category) {
    case 'cortex.llamacpp':
      return 'llama.cpp'
    case 'cortex.onnx':
      return 'Onnx'
    case 'cortex.tensorrt-llm':
      return 'Tensorrt-llm'
    case 'triton_trtllm':
      return 'Triton-trtllm'
    case 'BuiltInModels':
      return 'Built-in Models'
    case 'HuggingFace':
      return 'Hugging Face'
    case 'openai':
      return 'OpenAI'
    case 'openrouter':
      return 'OpenRouter'
    default:
      return category.charAt(0).toUpperCase() + category.slice(1)
  }
}

export const getDescriptionByCategory = (category: ModelHubCategory) => {
  switch (category) {
    case 'BuiltInModels':
      return 'All models used even offline, model performance depends on your device capability.'
    case 'HuggingFace':
      return 'All models used even offline, model performance depends on your device capability.'
    default:
      return ''
  }
}

export const getLogoByCategory = (category: ModelHubCategory) => {
  switch (category) {
    case 'BuiltInModels':
      return 'icons/app_icon.svg'
    case 'HuggingFace':
      return 'icons/ic_hugging_face.svg'
    default:
      return undefined
  }
}

export const getLogoByLocalEngine = (engine: LocalEngine) => {
  switch (engine) {
    case 'cortex.llamacpp':
      return 'icons/llamacpp.svg'

    default:
      return undefined
  }
}

export const getLogoByRemoteEngine = (engine: RemoteEngine) => {
  switch (engine) {
    case 'anthropic':
      return 'icons/anthropic.svg'
    case 'mistral':
      return 'icons/mistral.svg'
    case 'martian':
      return 'icons/martian.svg'
    case 'openrouter':
      return 'icons/openrouter.svg'
    case 'openai':
      return 'icons/openai.svg'
    case 'groq':
      return 'icons/groq.svg'
    case 'triton_trtllm':
      return 'icons/triton_trtllm.svg'
    case 'cohere':
      return 'icons/cohere.svg'
    case 'nvidia':
      return 'icons/nvidia.svg'

    default:
      return undefined
  }
}
