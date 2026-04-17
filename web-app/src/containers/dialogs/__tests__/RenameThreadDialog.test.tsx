import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RenameThreadDialog } from '../RenameThreadDialog'

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

describe('RenameThreadDialog', () => {
  const onRename = vi.fn()
  const onDropdownClose = vi.fn()
  const onOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders dialog when open (controlled)', () => {
    render(
      <RenameThreadDialog
        thread={mockThread}
        plainTitleForRename="Test Thread"
        onRename={onRename}
        open={true}
        onOpenChange={onOpenChange}
        withoutTrigger
      />
    )
    expect(screen.getByText('common:threadTitle')).toBeInTheDocument()
  })

  it('renders input with current title', () => {
    render(
      <RenameThreadDialog
        thread={mockThread}
        plainTitleForRename="Test Thread"
        onRename={onRename}
        open={true}
        onOpenChange={onOpenChange}
        withoutTrigger
      />
    )
    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('Test Thread')
  })

  it('disables rename button when title is unchanged', () => {
    render(
      <RenameThreadDialog
        thread={mockThread}
        plainTitleForRename="Test Thread"
        onRename={onRename}
        open={true}
        onOpenChange={onOpenChange}
        withoutTrigger
      />
    )
    const renameBtn = screen.getByText('common:rename')
    expect(renameBtn.closest('button')).toBeDisabled()
  })

  it('renders rename button in dialog', () => {
    render(
      <RenameThreadDialog
        thread={mockThread}
        plainTitleForRename="Test Thread"
        onRename={onRename}
        open={true}
        onOpenChange={onOpenChange}
        withoutTrigger
      />
    )
    expect(screen.getByText('common:rename')).toBeInTheDocument()
  })

  it('disables rename button when title is empty', () => {
    render(
      <RenameThreadDialog
        thread={mockThread}
        plainTitleForRename="Test Thread"
        onRename={onRename}
        open={true}
        onOpenChange={onOpenChange}
        withoutTrigger
      />
    )
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '   ' } })
    const renameBtn = screen.getByText('common:rename')
    expect(renameBtn.closest('button')).toBeDisabled()
  })
})
