import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AttachmentIngestionDialog from '../AttachmentIngestionDialog'

const mockChoose = vi.fn()
const mockCancel = vi.fn()

vi.mock('@/hooks/useAttachmentIngestionPrompt', () => ({
  useAttachmentIngestionPrompt: vi.fn(() => ({
    isModalOpen: true,
    currentAttachment: { name: 'test.pdf', size: 1048576 },
    currentIndex: 0,
    totalCount: 1,
    choose: mockChoose,
    cancel: mockCancel,
  })),
}))

vi.mock('@/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('AttachmentIngestionDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders attachment name and size', () => {
    render(<AttachmentIngestionDialog />)
    expect(screen.getByText('test.pdf')).toBeInTheDocument()
    expect(screen.getByText('1.0 MB')).toBeInTheDocument()
  })

  it('renders title and description', () => {
    render(<AttachmentIngestionDialog />)
    expect(screen.getByText('common:attachmentsIngestion.title')).toBeInTheDocument()
    expect(screen.getByText('common:attachmentsIngestion.description')).toBeInTheDocument()
  })

  it('calls choose with embeddings on embeddings click', () => {
    render(<AttachmentIngestionDialog />)
    fireEvent.click(screen.getByText('common:attachmentsIngestion.embeddings'))
    expect(mockChoose).toHaveBeenCalledWith('embeddings')
  })

  it('calls choose with inline on inline click', () => {
    render(<AttachmentIngestionDialog />)
    fireEvent.click(screen.getByText('common:attachmentsIngestion.inline'))
    expect(mockChoose).toHaveBeenCalledWith('inline')
  })

  it('calls cancel on cancel click', () => {
    render(<AttachmentIngestionDialog />)
    fireEvent.click(screen.getByText('common:cancel'))
    expect(mockCancel).toHaveBeenCalled()
  })
})
