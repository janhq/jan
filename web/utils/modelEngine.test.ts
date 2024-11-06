import { EngineManager, InferenceEngine, LocalOAIEngine } from '@janhq/core'
import {
  getTitleByEngine,
  isLocalEngine,
  priorityEngine,
  getLogoEngine,
} from './modelEngine'

jest.mock('@janhq/core', () => ({
  ...jest.requireActual('@janhq/core'),
  EngineManager: {
    instance: jest.fn().mockReturnValue({
      get: jest.fn(),
    }),
  },
}))

describe('isLocalEngine', () => {
  const mockEngineManagerInstance = EngineManager.instance()
  const mockGet = mockEngineManagerInstance.get as jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return false if engine is not found', () => {
    mockGet.mockReturnValue(null)
    const result = isLocalEngine('nonexistentEngine')
    expect(result).toBe(false)
  })

  it('should return true if engine is an instance of LocalOAIEngine', () => {
    const mockEngineObj = {
      __proto__: {
        constructor: {
          __proto__: {
            name: LocalOAIEngine.name,
          },
        },
      },
    }
    mockGet.mockReturnValue(mockEngineObj)
    const result = isLocalEngine('localEngine')
    expect(result).toBe(true)
  })

  it('should return false if engine is not an instance of LocalOAIEngine', () => {
    const mockEngineObj = {
      __proto__: {
        constructor: {
          __proto__: {
            name: 'SomeOtherEngine',
          },
        },
      },
    }
    mockGet.mockReturnValue(mockEngineObj)
    const result = isLocalEngine('someOtherEngine')
    expect(result).toBe(false)
  })

  jest.mock('@janhq/core', () => ({
    ...jest.requireActual('@janhq/core'),
    EngineManager: {
      instance: jest.fn().mockReturnValue({
        get: jest.fn(),
      }),
    },
  }))

  describe('getTitleByEngine', () => {
    it('should return correct title for InferenceEngine.nitro', () => {
      const result = getTitleByEngine(InferenceEngine.nitro)
      expect(result).toBe('Llama.cpp (Cortex)')
    })

    it('should return correct title for InferenceEngine.nitro_tensorrt_llm', () => {
      const result = getTitleByEngine(InferenceEngine.nitro_tensorrt_llm)
      expect(result).toBe('TensorRT-LLM (Nitro)')
    })

    it('should return correct title for InferenceEngine.cortex_llamacpp', () => {
      const result = getTitleByEngine(InferenceEngine.cortex_llamacpp)
      expect(result).toBe('Llama.cpp (Cortex)')
    })

    it('should return correct title for InferenceEngine.cortex_onnx', () => {
      const result = getTitleByEngine(InferenceEngine.cortex_onnx)
      expect(result).toBe('Onnx (Cortex)')
    })

    it('should return correct title for InferenceEngine.cortex_tensorrtllm', () => {
      const result = getTitleByEngine(InferenceEngine.cortex_tensorrtllm)
      expect(result).toBe('TensorRT-LLM (Cortex)')
    })

    it('should return correct title for InferenceEngine.openai', () => {
      const result = getTitleByEngine(InferenceEngine.openai)
      expect(result).toBe('OpenAI')
    })

    it('should return correct title for InferenceEngine.openrouter', () => {
      const result = getTitleByEngine(InferenceEngine.openrouter)
      expect(result).toBe('OpenRouter')
    })

    it('should return capitalized engine name for unknown engine', () => {
      const result = getTitleByEngine('unknownEngine' as InferenceEngine)
      expect(result).toBe('UnknownEngine')
    })
  })

  describe('priorityEngine', () => {
    it('should contain the correct engines in the correct order', () => {
      expect(priorityEngine).toEqual([
        InferenceEngine.cortex_llamacpp,
        InferenceEngine.cortex_onnx,
        InferenceEngine.cortex_tensorrtllm,
        InferenceEngine.nitro,
      ])
    })
  })

  describe('getLogoEngine', () => {
    it('should return correct logo path for InferenceEngine.anthropic', () => {
      const result = getLogoEngine(InferenceEngine.anthropic)
      expect(result).toBe('images/ModelProvider/anthropic.svg')
    })

    it('should return correct logo path for InferenceEngine.nitro_tensorrt_llm', () => {
      const result = getLogoEngine(InferenceEngine.nitro_tensorrt_llm)
      expect(result).toBe('images/ModelProvider/nitro.svg')
    })

    it('should return correct logo path for InferenceEngine.cortex_llamacpp', () => {
      const result = getLogoEngine(InferenceEngine.cortex_llamacpp)
      expect(result).toBe('images/ModelProvider/cortex.svg')
    })

    it('should return correct logo path for InferenceEngine.mistral', () => {
      const result = getLogoEngine(InferenceEngine.mistral)
      expect(result).toBe('images/ModelProvider/mistral.svg')
    })

    it('should return correct logo path for InferenceEngine.martian', () => {
      const result = getLogoEngine(InferenceEngine.martian)
      expect(result).toBe('images/ModelProvider/martian.svg')
    })

    it('should return correct logo path for InferenceEngine.openrouter', () => {
      const result = getLogoEngine(InferenceEngine.openrouter)
      expect(result).toBe('images/ModelProvider/openRouter.svg')
    })

    it('should return correct logo path for InferenceEngine.openai', () => {
      const result = getLogoEngine(InferenceEngine.openai)
      expect(result).toBe('images/ModelProvider/openai.svg')
    })

    it('should return correct logo path for InferenceEngine.groq', () => {
      const result = getLogoEngine(InferenceEngine.groq)
      expect(result).toBe('images/ModelProvider/groq.svg')
    })

    it('should return correct logo path for InferenceEngine.triton_trtllm', () => {
      const result = getLogoEngine(InferenceEngine.triton_trtllm)
      expect(result).toBe('images/ModelProvider/triton_trtllm.svg')
    })

    it('should return correct logo path for InferenceEngine.cohere', () => {
      const result = getLogoEngine(InferenceEngine.cohere)
      expect(result).toBe('images/ModelProvider/cohere.svg')
    })

    it('should return correct logo path for InferenceEngine.nvidia', () => {
      const result = getLogoEngine(InferenceEngine.nvidia)
      expect(result).toBe('images/ModelProvider/nvidia.svg')
    })

    it('should return undefined for unknown engine', () => {
      const result = getLogoEngine('unknownEngine' as InferenceEngine)
      expect(result).toBeUndefined()
    })
  })
})
