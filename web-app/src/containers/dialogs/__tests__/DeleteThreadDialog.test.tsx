import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DeleteThreadDialog } from '../DeleteThreadDialog'

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockThread: Thread = {
  id: 'thread-1',
  title: 'Test Thread',
  updated: Date.now(),
}

describe('DeleteThreadDialog', () => {
  const onDelete = vi.fn()
  const onDropdownClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders dialog content when open (controlled)', () => {
    render(
      <DeleteThreadDialog
        thread={mockThread}
        onDelete={onDelete}
        open={true}
        onOpenChange={vi.fn()}
        withoutTrigger
      />
    )
    expect(screen.getByText('common:deleteThread')).toBeInTheDocument()
    expect(screen.getByText('common:dialogs.deleteThread.description')).toBeInTheDocument()
  })

  it('calls onDelete and onDropdownClose when delete button clicked', () => {
    render(
      <DeleteThreadDialog
        thread={mockThread}
        onDelete={onDelete}
        onDropdownClose={onDropdownClose}
        open={true}
        onOpenChange={vi.fn()}
        withoutTrigger
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /common:delete/i }))
    expect(onDelete).toHaveBeenCalledWith('thread-1')
    expect(onDropdownClose).toHaveBeenCalled()
  })

  it('renders without crashing when withoutTrigger is true', () => {
    const { container } = render(
      <DeleteThreadDialog
        thread={mockThread}
        onDelete={onDelete}
        open={true}
        onOpenChange={vi.fn()}
        withoutTrigger
      />
    )
    expect(container).toBeTruthy()
  })

  it('shows cancel button', () => {
    render(
      <DeleteThreadDialog
        thread={mockThread}
        onDelete={onDelete}
        open={true}
        onOpenChange={vi.fn()}
        withoutTrigger
      />
    )
    expect(screen.getByText('common:cancel')).toBeInTheDocument()
  })
})
