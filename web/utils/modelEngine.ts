import { InferenceEngine } from '@janhq/core'

export const getLogoEngine = (engine: InferenceEngine) => {
  switch (engine) {
    case InferenceEngine.anthropic:
      return 'images/ModelProvider/anthropic.svg'
    case InferenceEngine.nitro:
      return 'images/ModelProvider/nitro.svg'
    case InferenceEngine.cortex_llamacpp':
    case InferenceEngine.cortex_onnx:
    case InferenceEngine.cortex_tensorrtllm:
      return 'images/ModelProvider/cortex.svg'
    case InferenceEngine.mistral:
      return 'images/ModelProvider/mistral.svg'
    case InferenceEngine.martian:
      return 'images/ModelProvider/martian.svg'
    case InferenceEngine.openrouter:
      return 'images/ModelProvider/openrouter.svg'
    case InferenceEngine.openai:
      return 'images/ModelProvider/openai.svg'
    case InferenceEngine.groq:
      return 'images/ModelProvider/groq.svg'
    case InferenceEngine.triton_trtllm:
      return 'images/ModelProvider/triton_trtllm.svg'
    case InferenceEngine.cohere:
      return 'images/ModelProvider/cohere.svg'
    case InferenceEngine.nvidia:
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
    case InferenceEngine.nitro:
      return 'Llama.cpp (Nitro)'
    case InferenceEngine.cortex_llamacpp:
      return 'Llama.cpp (Cortex)'
    case InferenceEngine.cortex_onnx:
      return 'Onnx (Cortex)'
    case InferenceEngine.cortex_tensorrtllm:
      return 'TensorRT-LLM (Cortex)'
    case InferenceEngine.openai:
      return 'OpenAI'
    case InferenceEngine.openrouter:
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
