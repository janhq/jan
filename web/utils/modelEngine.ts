import { InferenceEngine } from '@janhq/core'

export const getLogoEngine = (engine: InferenceEngine) => {
  switch (engine) {
    case 'anthropic':
      return 'images/ModelProvider/anthropic.svg'
    case 'nitro':
      return 'images/ModelProvider/nitro.svg'
    case 'cortex.llamacpp':
    case 'cortex.onnx':
    case 'cortex.tensorrtllm':
      return 'images/ModelProvider/cortex.svg'
    case 'mistral':
      return 'images/ModelProvider/mistral.svg'
    case 'martian':
      return 'images/ModelProvider/martian.svg'
    case 'openrouter':
      return 'images/ModelProvider/openrouter.svg'
    case 'openai':
      return 'images/ModelProvider/openai.svg'
    case 'groq':
      return 'images/ModelProvider/groq.svg'
    case 'triton_trtllm':
      return 'images/ModelProvider/triton_trtllm.svg'
    case 'cohere':
      return 'images/ModelProvider/cohere.svg'
    case 'nvidia':
      return 'images/ModelProvider/nvidia.svg'
    default:
      return undefined
  }
}

export const localEngines = [
  InferenceEngine.nitro,
  InferenceEngine.nitro_tensorrt_llm,
  InferenceEngine.cortex_llamacpp,
  InferenceEngine.cortex_onnx,
  InferenceEngine.cortex_tensorrtllm,
]

export const getTitleByEngine = (engine: InferenceEngine) => {
  switch (engine) {
    case 'nitro':
      return 'Llama.cpp (Nitro)'
    case 'cortex.llamacpp':
      return 'Llama.cpp (Cortex)'
    case 'cortex.onnx':
      return 'Onnx (Cortex)'
    case 'cortex.tensorrtllm':
      return 'TensorRT-LLM (Cortex)'
    case 'openai':
      return 'OpenAI'
    case 'openrouter':
      return 'OpenRouter'
    default:
      return engine.charAt(0).toUpperCase() + engine.slice(1)
  }
}

export const priorityEngine = [
  InferenceEngine.cortex_llamacpp,
  InferenceEngine.cortex_onnx,
  InferenceEngine.cortex_tensorrtllm,
  InferenceEngine.nitro,
]
