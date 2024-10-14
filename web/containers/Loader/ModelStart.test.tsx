import '@testing-library/jest-dom'
import { render, screen, act } from '@testing-library/react'
import ModelStart from './ModelStart' // Adjust the path based on your file structure
import { useActiveModel } from '@/hooks/useActiveModel'

// Mock the useActiveModel hook
jest.mock('@/hooks/useActiveModel', () => ({
  useActiveModel: jest.fn(),
}))

describe('ModelStart', () => {
  const mockSetStateModel = jest.fn()
  const mockModel = { id: 'test-model' }

  beforeEach(() => {
    // Reset the mock implementation before each test
    jest.clearAllMocks()
  })

  it('renders correctly when loading is false', () => {
    ;(useActiveModel as jest.Mock).mockReturnValue({
      stateModel: {
        loading: false,
        state: 'start',
        model: mockModel,
      },
    })

    render(<ModelStart />)
    // Ensure the component returns null when not loading
    expect(screen.queryByText(/Starting model/i)).toBeNull()
  })

  it('renders loading state with model id', () => {
    ;(useActiveModel as jest.Mock).mockReturnValue({
      stateModel: {
        loading: true,
        state: 'start',
        model: mockModel,
      },
    })

    render(<ModelStart />)
    // Ensure the loading text is rendered
    expect(screen.getByText(/Starting model test-model/i)).toBeInTheDocument()
  })
})
