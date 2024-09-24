import { render, screen, waitFor } from '@testing-library/react'
import { useAtomValue, useAtom, useSetAtom } from 'jotai'
import ModelDropdown from './index'
import useRecommendedModel from '@/hooks/useRecommendedModel'
import '@testing-library/jest-dom'

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

  const configuredModels = [remoteModel, localModel]

  const mockConfiguredModel = configuredModels
  const selectedModel = { id: 'selectedModel', name: 'selectedModel' }
  const setSelectedModel = jest.fn()
  const showEngineListModel = ['nitro']
  const showEngineListModelAtom = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useAtom as jest.Mock).mockReturnValue([selectedModel, setSelectedModel])
    ;(useAtom as jest.Mock).mockReturnValue([
      showEngineListModel,
      showEngineListModelAtom,
    ])
    ;(useAtomValue as jest.Mock).mockReturnValue(mockConfiguredModel)
    ;(useRecommendedModel as jest.Mock).mockReturnValue({
      recommendedModel: { id: 'model1', parameters: [], settings: [] },
      downloadedModels: [],
    })
  })

  it('renders the ModelDropdown component', async () => {
    render(<ModelDropdown />)

    await waitFor(() => {
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    })
  })

  it('renders the ModelDropdown component as disabled', async () => {
    render(<ModelDropdown disabled />)

    await waitFor(() => {
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
      expect(screen.getByTestId('model-selector')).toHaveClass(
        'pointer-events-none'
      )
    })
  })

  it('renders the ModelDropdown component as badge for chat Input', async () => {
    render(<ModelDropdown chatInputMode />)

    await waitFor(() => {
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
      expect(screen.getByTestId('model-selector-badge')).toBeInTheDocument()
      expect(screen.getByTestId('model-selector-badge')).toHaveClass('badge')
    })
  })

  it('renders the Tab correctly', async () => {
    render(<ModelDropdown />)

    await waitFor(() => {
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
      expect(screen.getByText('On-device'))
      expect(screen.getByText('Cloud'))
    })
  })
})
