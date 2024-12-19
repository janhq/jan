import { renderHook, act } from '@testing-library/react'
import { useAtom } from 'jotai'
// Mock dependencies
jest.mock('ulidx')
jest.mock('@/extension')
jest.mock('jotai', () => ({
  ...jest.requireActual('jotai'),
  useAtom: jest.fn(),
}))

import useUpdateModelParameters from './useUpdateModelParameters'
import { extensionManager } from '@/extension'

// Mock data
let model: any = {
  id: 'model-1',
  engine: 'nitro',
}

let extension: any = {
  modifyThread: jest.fn(),
  modifyThreadAssistant: jest.fn(),
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
    jest.useFakeTimers()
    jest.mock('./useRecommendedModel', () => ({
      useRecommendedModel: () => ({
        recommendedModel: model,
        setRecommendedModel: jest.fn(),
        downloadedModels: [],
      }),
    }))
  })

  it('should update model parameters and save thread when params are valid', async () => {
    ;(useAtom as jest.Mock).mockReturnValue([
      {
        id: 'assistant-1',
      },
      jest.fn(),
    ])
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
    jest.spyOn(extension, 'modifyThread').mockReturnValue({})
    jest.spyOn(extension, 'modifyThreadAssistant').mockReturnValue({})

    const { result } = renderHook(() => useUpdateModelParameters())

    await act(async () => {
      await result.current.updateModelParameter(mockThread, mockValidParameters)
    })

    jest.runAllTimers()

    // Check if the model parameters are valid before persisting
    expect(extension.modifyThreadAssistant).toHaveBeenCalledWith('thread-1', {
      id: 'assistant-1',
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
        id: 'model-1',
        engine: 'nitro',
      },
    })
  })

  it('should not update invalid model parameters', async () => {
    ;(useAtom as jest.Mock).mockReturnValue([
      {
        id: 'assistant-1',
      },
      jest.fn(),
    ])
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
    jest.spyOn(extension, 'modifyThread').mockReturnValue({})
    jest.spyOn(extension, 'modifyThreadAssistant').mockReturnValue({})

    const { result } = renderHook(() => useUpdateModelParameters())

    await act(async () => {
      await result.current.updateModelParameter(
        mockThread,
        mockInvalidParameters
      )
    })

    jest.runAllTimers()

    // Check if the model parameters are valid before persisting
    expect(extension.modifyThreadAssistant).toHaveBeenCalledWith('thread-1', {
      id: 'assistant-1',
      model: {
        engine: 'nitro',
        id: 'model-1',
        parameters: {
          token_limit: 1000,
          max_tokens: 1000,
        },
        settings: {
          cpu_threads: 4,
          ctx_len: 1024,
          prompt_template: 'template',
          llama_model_path: 'path',
          mmproj: 'mmproj',
          n_parallel: 2,
          ngl: 12,
        },
      },
    })
  })

  it('should update valid model parameters only', async () => {
    ;(useAtom as jest.Mock).mockReturnValue([
      {
        id: 'assistant-1',
      },
      jest.fn(),
    ])
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
    jest.spyOn(extension, 'modifyThread').mockReturnValue({})
    jest.spyOn(extension, 'modifyThreadAssistant').mockReturnValue({})
    const { result } = renderHook(() => useUpdateModelParameters())

    await act(async () => {
      await result.current.updateModelParameter(
        mockThread,
        mockInvalidParameters
      )
    })
    jest.runAllTimers()

    // Check if the model parameters are valid before persisting
    expect(extension.modifyThreadAssistant).toHaveBeenCalledWith('thread-1', {
      id: 'assistant-1',
      model: {
        engine: 'nitro',
        id: 'model-1',
        parameters: {
          stop: ['<eos>'],
          top_k: 0.7,
          top_p: 0.1,
          stream: true,
          token_limit: 100,
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
    })
  })
})
