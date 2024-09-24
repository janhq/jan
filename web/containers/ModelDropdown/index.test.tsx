import { render, screen, waitFor } from '@testing-library/react'
import { useAtomValue, useAtom, useSetAtom } from 'jotai'
import ModelDropdown from './index'
import useRecommendedModel from '@/hooks/useRecommendedModel'
import '@testing-library/jest-dom'
import ModelLabel from '@/containers/ModelLabel'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock

jest.mock('jotai', () => {
  const originalModule = jest.requireActual('jotai')
  return {
    ...originalModule,
    useAtom: jest.fn(),
    useAtomValue: jest.fn(),
    useSetAtom: jest.fn(),
  }
})

jest.mock('@/containers/ModelLabel')
jest.mock('@/hooks/useRecommendedModel')

describe('ModelDropdown', () => {
  const remoteModel = {
    metadata: { tags: ['Featured'], size: 100 },
    name: 'Test Model',
    engine: 'openai',
  }

  const localModel = {
    metadata: { tags: ['Local'], size: 100 },
    name: 'Local Model',
    engine: 'nitro',
  }

  const selectedModelMock = { id: 'selectedModel', name: 'selectedModel' }
  const activeThreadMock = {
    id: '1',
    object: 'thread',
    title: 'New Thread',
    assistants: [
      {
        assistant_id: 'jan',
        assistant_name: 'Jan',
        model: {
          id: 'selectedModel',
          name: 'selectedModel',
          engine: 'nitro',
        },
      },
    ],
    created: 1727145391467,
    updated: 1727145391467,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useAtomValue as jest.Mock).mockReturnValueOnce(activeThreadMock)
    ;(useAtomValue as jest.Mock).mockReturnValueOnce(jest.fn())
    ;(useAtom as jest.Mock).mockReturnValueOnce(selectedModelMock)
    ;(useRecommendedModel as jest.Mock).mockReturnValueOnce({
      recommendedModel: { id: 'model1', parameters: [], settings: [] },
      downloadedModels: [],
    })
  })

  it('renders the ModelDropdown component', async () => {
    render(<ModelDropdown />)
    await waitFor(() => {
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
      expect(screen.getByDisplayValue('selectedModel')).toBeInTheDocument()
    })
  })
})
