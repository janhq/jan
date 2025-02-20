import { Engines, InferenceEngine } from '@janhq/core'

export const getLogoEngine = (engine: InferenceEngine | string) => {
  switch (engine) {
    case InferenceEngine.nitro:
    case InferenceEngine.cortex_llamacpp:
    case InferenceEngine.cortex_onnx:
    case InferenceEngine.cortex_tensorrtllm:
      return 'images/ModelProvider/cortex.svg'
    case InferenceEngine.anthropic:
      return 'images/ModelProvider/anthropic.svg'
    case InferenceEngine.nitro_tensorrt_llm:
      return 'images/ModelProvider/nitro.svg'

    case InferenceEngine.mistral:
      return 'images/ModelProvider/mistral.svg'
    case InferenceEngine.martian:
      return 'images/ModelProvider/martian.svg'
    case InferenceEngine.openrouter:
      return 'images/ModelProvider/openRouter.svg'
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
    // MARK: Deprecating InferenceEngine enum - as it's dynamically provided by the backend
    case 'google_gemini':
      return 'images/ModelProvider/google.svg'
    case 'deepseek':
      return 'images/ModelProvider/deepseek.svg'
    default:
      return undefined
  }
}

/**
 * Check whether the engine is conform to LocalOAIEngine
 * @param engine
 * @returns
 */
export const isLocalEngine = (engines?: Engines, engine?: string) => {
  if (!engines || !engine) return false

  return engines[engine as InferenceEngine]?.[0]?.type === 'local'
}

export const getTitleByEngine = (engine: InferenceEngine | string) => {
  switch (engine) {
    case InferenceEngine.nitro:
    case InferenceEngine.cortex_llamacpp:
      return 'Llama.cpp'
    case InferenceEngine.nitro_tensorrt_llm:
      return 'TensorRT-LLM (Nitro)'
    case InferenceEngine.cortex_onnx:
      return 'Onnx'
    case InferenceEngine.cortex_tensorrtllm:
      return 'TensorRT-LLM'
    case InferenceEngine.openai:
      return 'OpenAI'
    case InferenceEngine.openrouter:
      return 'OpenRouter'
    case 'google_gemini':
      return 'Google'
    default:
      return engine.charAt(0).toUpperCase() + engine.slice(1)
  }
}

export const getDescriptionByEngine = (engine: InferenceEngine) => {
  switch (engine) {
    case InferenceEngine.anthropic:
      return 'Creator of Claude AI models renowned for exceptional reasoning, analysis, and coding capabilities. Claude models combine high intelligence with strong safety and ethics, making them ideal for complex tasks from research to technical writing.'
    case InferenceEngine.cohere:
      return 'Enterprise-focused language models designed for business needs. Specializing in reliable content generation, summarization, and semantic analysis with consistent quality and scalable performance.'
    case InferenceEngine.groq:
      return 'An innovative AI infrastructure provider revolutionizing model speed. Their custom-built hardware platform delivers ultra-fast inference while maintaining high-quality outputs.'
    case InferenceEngine.martian:
      return 'Production-first language models balancing performance with practicality. Built for reliable deployment and consistent results across diverse real-world applications.'
    case InferenceEngine.mistral:
      return 'A breakthrough in open-source language models. Their instruction-tuned models like Mixtral and Mistral combine competitive performance with efficient resource usage across reasoning, coding, and general tasks.'
    case InferenceEngine.nvidia:
      return 'Industry leaders in AI hardware and software solutions. Their models leverage deep GPU expertise to deliver high-performance AI capabilities optimized for enterprise use.'
    case InferenceEngine.openai:
      return 'Creator of GPT models that set industry benchmarks. Their models excel across text, code, and image generation, consistently setting new standards for AI capabilities.'
    case InferenceEngine.openrouter:
      return 'A unified platform aggregating top AI models from various providers. Simplifies AI deployment by offering seamless access to multiple services through standardized integration.'
    default:
      return `Access models from ${getTitleByEngine(engine)} via their API.`
  }
}

export const priorityEngine = [
  InferenceEngine.cortex_llamacpp,
  InferenceEngine.cortex_onnx,
  InferenceEngine.cortex_tensorrtllm,
  InferenceEngine.nitro,
]
