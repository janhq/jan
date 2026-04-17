import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DeleteMessageDialog } from '../DeleteMessageDialog'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('DeleteMessageDialog', () => {
  const onDelete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders trigger button with trash icon', () => {
    render(<DeleteMessageDialog onDelete={onDelete} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('opens dialog when trigger is clicked', () => {
    render(<DeleteMessageDialog onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('common:deleteMessage')).toBeInTheDocument()
    expect(screen.getByText(/Are you sure you want to delete this message/)).toBeInTheDocument()
  })

  it('calls onDelete when delete button in dialog is clicked', () => {
    render(<DeleteMessageDialog onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button'))
    // Now find the destructive delete button by aria-label
    fireEvent.click(screen.getByRole('button', { name: 'common:deleteMessage' }))
    expect(onDelete).toHaveBeenCalled()
  })

  it('shows cancel button in dialog', () => {
    render(<DeleteMessageDialog onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('common:cancel')).toBeInTheDocument()
  })
})
