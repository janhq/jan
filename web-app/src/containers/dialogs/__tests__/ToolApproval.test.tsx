import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ToolApproval from '../ToolApproval'

const mockOnApprove = vi.fn()
const mockOnDeny = vi.fn()
const mockSetModalOpen = vi.fn()

vi.mock('@/hooks/useToolApproval', () => ({
  useToolApproval: vi.fn(() => ({
    isModalOpen: true,
    setModalOpen: mockSetModalOpen,
    modalProps: {
      toolName: 'test-tool',
      toolParameters: { arg1: 'value1' },
      onApprove: mockOnApprove,
      onDeny: mockOnDeny,
    },
  })),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('lucide-react', () => ({
  AlertTriangle: () => <div data-testid="alert-icon" />,
}))

describe('ToolApproval', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders dialog with tool name', () => {
    render(<ToolApproval />)
    expect(screen.getByText('tools:toolApproval.title')).toBeInTheDocument()
    expect(screen.getByText('test-tool')).toBeInTheDocument()
  })

  it('displays tool parameters', () => {
    render(<ToolApproval />)
    expect(screen.getByText('tools:toolApproval.parameters')).toBeInTheDocument()
  })

  it('calls onApprove(true) for allow once', () => {
    render(<ToolApproval />)
    fireEvent.click(screen.getByText('tools:toolApproval.allowOnce'))
    expect(mockOnApprove).toHaveBeenCalledWith(true)
  })

  it('calls onApprove(false) for always allow', () => {
    render(<ToolApproval />)
    fireEvent.click(screen.getByText('tools:toolApproval.alwaysAllow'))
    expect(mockOnApprove).toHaveBeenCalledWith(false)
  })

  it('calls onDeny on deny click', () => {
    render(<ToolApproval />)
    fireEvent.click(screen.getByText('tools:toolApproval.deny'))
    expect(mockOnDeny).toHaveBeenCalled()
  })
})
