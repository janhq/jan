import { renderHook, act } from '@testing-library/react'
// Mock dependencies
jest.mock('ulidx')
jest.mock('@/extension')

import useUpdateModelParameters from './useUpdateModelParameters'
import { extensionManager } from '@/extension'

// Mock data
let model: any = {
  id: 'model-1',
  engine: 'nitro',
}

let extension: any = {
  saveThread: jest.fn(),
}

const mockThread: any = {
  id: 'thread-1',
  assistants: [
    {
      model: {
        parameters: {},
        settings: {},
      },
    },
  ],
  object: 'thread',
  title: 'New Thread',
  created: 0,
  updated: 0,
}

describe('useUpdateModelParameters', () => {
  beforeAll(() => {
    jest.clearAllMocks()
    jest.mock('./useRecommendedModel', () => ({
      useRecommendedModel: () => ({
        recommendedModel: model,
        setRecommendedModel: jest.fn(),
        downloadedModels: [],
      }),
    }))
  })

  it('should update model parameters and save thread when params are valid', async () => {
    const mockValidParameters: any = {
      params: {
        // Inference
        stop: ['<eos>', '<eos2>'],
        temperature: 0.5,
        token_limit: 1000,
        top_k: 0.7,
        top_p: 0.1,
        stream: true,
        max_tokens: 1000,
        frequency_penalty: 0.3,
        presence_penalty: 0.2,

        // Load model
        ctx_len: 1024,
        ngl: 12,
        embedding: true,
        n_parallel: 2,
        cpu_threads: 4,
        prompt_template: 'template',
        llama_model_path: 'path',
        mmproj: 'mmproj',
        vision_model: 'vision',
        text_model: 'text',
      },
      modelId: 'model-1',
      engine: 'nitro',
    }

    // Spy functions
    jest.spyOn(extensionManager, 'get').mockReturnValue(extension)
    jest.spyOn(extension, 'saveThread').mockReturnValue({})

    const { result } = renderHook(() => useUpdateModelParameters())

    await act(async () => {
      await result.current.updateModelParameter(mockThread, mockValidParameters)
    })

    // Check if the model parameters are valid before persisting
    expect(extension.saveThread).toHaveBeenCalledWith({
      assistants: [
        {
          model: {
            parameters: {
              stop: ['<eos>', '<eos2>'],
              temperature: 0.5,
              token_limit: 1000,
              top_k: 0.7,
              top_p: 0.1,
              stream: true,
              max_tokens: 1000,
              frequency_penalty: 0.3,
              presence_penalty: 0.2,
            },
            settings: {
              ctx_len: 1024,
              ngl: 12,
              embedding: true,
              n_parallel: 2,
              cpu_threads: 4,
              prompt_template: 'template',
              llama_model_path: 'path',
              mmproj: 'mmproj',
            },
          },
        },
      ],
      created: 0,
      id: 'thread-1',
      object: 'thread',
      title: 'New Thread',
      updated: 0,
    })
  })

  it('should not update invalid model parameters', async () => {
    const mockInvalidParameters: any = {
      params: {
        // Inference
        stop: [1, '<eos>'],
        temperature: '0.5',
        token_limit: '1000',
        top_k: '0.7',
        top_p: '0.1',
        stream: 'true',
        max_tokens: '1000',
        frequency_penalty: '0.3',
        presence_penalty: '0.2',

        // Load model
        ctx_len: '1024',
        ngl: '12',
        embedding: 'true',
        n_parallel: '2',
        cpu_threads: '4',
        prompt_template: 'template',
        llama_model_path: 'path',
        mmproj: 'mmproj',
        vision_model: 'vision',
        text_model: 'text',
      },
      modelId: 'model-1',
      engine: 'nitro',
    }

    // Spy functions
    jest.spyOn(extensionManager, 'get').mockReturnValue(extension)
    jest.spyOn(extension, 'saveThread').mockReturnValue({})

    const { result } = renderHook(() => useUpdateModelParameters())

    await act(async () => {
      await result.current.updateModelParameter(
        mockThread,
        mockInvalidParameters
      )
    })

    // Check if the model parameters are valid before persisting
    expect(extension.saveThread).toHaveBeenCalledWith({
      assistants: [
        {
          model: {
            parameters: {},
            settings: {
              prompt_template: 'template',
              llama_model_path: 'path',
              mmproj: 'mmproj',
            },
          },
        },
      ],
      created: 0,
      id: 'thread-1',
      object: 'thread',
      title: 'New Thread',
      updated: 0,
    })
  })

  it('should update valid model parameters only', async () => {
    const mockInvalidParameters: any = {
      params: {
        // Inference
        stop: ['<eos>'],
        temperature: -0.5,
        token_limit: 100.2,
        top_k: 0.7,
        top_p: 0.1,
        stream: true,
        max_tokens: 1000,
        frequency_penalty: 1.2,
        presence_penalty: 0.2,

        // Load model
        ctx_len: 1024,
        ngl: 0,
        embedding: 'true',
        n_parallel: 2,
        cpu_threads: 4,
        prompt_template: 'template',
        llama_model_path: 'path',
        mmproj: 'mmproj',
        vision_model: 'vision',
        text_model: 'text',
      },
      modelId: 'model-1',
      engine: 'nitro',
    }

    // Spy functions
    jest.spyOn(extensionManager, 'get').mockReturnValue(extension)
    jest.spyOn(extension, 'saveThread').mockReturnValue({})

    const { result } = renderHook(() => useUpdateModelParameters())

    await act(async () => {
      await result.current.updateModelParameter(
        mockThread,
        mockInvalidParameters
      )
    })

    // Check if the model parameters are valid before persisting
    expect(extension.saveThread).toHaveBeenCalledWith({
      assistants: [
        {
          model: {
            parameters: {
              stop: ['<eos>'],
              top_k: 0.7,
              top_p: 0.1,
              stream: true,
              max_tokens: 1000,
              presence_penalty: 0.2,
            },
            settings: {
              ctx_len: 1024,
              ngl: 0,
              n_parallel: 2,
              cpu_threads: 4,
              prompt_template: 'template',
              llama_model_path: 'path',
              mmproj: 'mmproj',
            },
          },
        },
      ],
      created: 0,
      id: 'thread-1',
      object: 'thread',
      title: 'New Thread',
      updated: 0,
    })
  })

  it('should handle missing modelId and engine gracefully', async () => {
    const mockParametersWithoutModelIdAndEngine: any = {
      params: {
        stop: ['<eos>', '<eos2>'],
        temperature: 0.5,
      },
    }

    // Spy functions
    jest.spyOn(extensionManager, 'get').mockReturnValue(extension)
    jest.spyOn(extension, 'saveThread').mockReturnValue({})

    const { result } = renderHook(() => useUpdateModelParameters())

    await act(async () => {
      await result.current.updateModelParameter(
        mockThread,
        mockParametersWithoutModelIdAndEngine
      )
    })

    // Check if the model parameters are valid before persisting
    expect(extension.saveThread).toHaveBeenCalledWith({
      assistants: [
        {
          model: {
            parameters: {
              stop: ['<eos>', '<eos2>'],
              temperature: 0.5,
            },
            settings: {},
          },
        },
      ],
      created: 0,
      id: 'thread-1',
      object: 'thread',
      title: 'New Thread',
      updated: 0,
    })
  })
})
