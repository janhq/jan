import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import OutOfContextPromiseModal from '../OutOfContextDialog'
import { useContextSizeApproval } from '@/hooks/useModelContextApproval'

vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('OutOfContextPromiseModal', () => {
  const mockOnApprove = vi.fn()
  const mockOnDeny = vi.fn()
  const mockSetModalOpen = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when modalProps is null', () => {
    useContextSizeApproval.setState({
      isModalOpen: false,
      modalProps: null,
    })
    const { container } = render(<OutOfContextPromiseModal />)
    expect(container.innerHTML).toBe('')
  })

  it('renders dialog when modal is open with props', () => {
    useContextSizeApproval.setState({
      isModalOpen: true,
      modalProps: {
        onApprove: mockOnApprove,
        onDeny: mockOnDeny,
      },
      setModalOpen: mockSetModalOpen,
    })
    render(<OutOfContextPromiseModal />)
    expect(screen.getByText('model-errors:title')).toBeInTheDocument()
    expect(screen.getByText(/model-errors:description/)).toBeInTheDocument()
  })

  it('calls onApprove with context_shift when truncate button clicked', () => {
    useContextSizeApproval.setState({
      isModalOpen: true,
      modalProps: {
        onApprove: mockOnApprove,
        onDeny: mockOnDeny,
      },
      setModalOpen: mockSetModalOpen,
    })
    render(<OutOfContextPromiseModal />)
    fireEvent.click(screen.getByText('model-errors:truncateInput'))
    expect(mockOnApprove).toHaveBeenCalledWith('context_shift')
  })

  it('calls onApprove with ctx_len when increase context button clicked', () => {
    useContextSizeApproval.setState({
      isModalOpen: true,
      modalProps: {
        onApprove: mockOnApprove,
        onDeny: mockOnDeny,
      },
      setModalOpen: mockSetModalOpen,
    })
    render(<OutOfContextPromiseModal />)
    fireEvent.click(screen.getByText('model-errors:increaseContextSize'))
    expect(mockOnApprove).toHaveBeenCalledWith('ctx_len')
  })
})
