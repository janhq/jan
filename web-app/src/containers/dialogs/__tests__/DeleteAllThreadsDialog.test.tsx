import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DeleteAllThreadsDialog } from '../DeleteAllThreadsDialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function renderInDropdown(ui: React.ReactElement) {
  return render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>trigger</DropdownMenuTrigger>
      <DropdownMenuContent>{ui}</DropdownMenuContent>
    </DropdownMenu>
  )
}

describe('DeleteAllThreadsDialog', () => {
  const onDeleteAll = vi.fn()
  const onDropdownClose = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('renders trigger text', () => {
    renderInDropdown(<DeleteAllThreadsDialog onDeleteAll={onDeleteAll} />)
    expect(screen.getByText('common:deleteAll')).toBeInTheDocument()
  })

  it('opens dialog and shows title on trigger click', () => {
    renderInDropdown(<DeleteAllThreadsDialog onDeleteAll={onDeleteAll} />)
    fireEvent.click(screen.getByText('common:deleteAll'))
    expect(screen.getByText('common:dialogs.deleteAllThreads.title')).toBeInTheDocument()
    expect(screen.getByText('common:dialogs.deleteAllThreads.description')).toBeInTheDocument()
  })

  it('calls onDeleteAll and onDropdownClose on delete', () => {
    renderInDropdown(
      <DeleteAllThreadsDialog onDeleteAll={onDeleteAll} onDropdownClose={onDropdownClose} />
    )
    fireEvent.click(screen.getByText('common:deleteAll'))
    // Click the delete button (aria-label)
    fireEvent.click(screen.getByRole('button', { name: 'common:deleteAll' }))
    expect(onDeleteAll).toHaveBeenCalled()
    expect(onDropdownClose).toHaveBeenCalled()
  })

  it('shows cancel button in dialog', () => {
    renderInDropdown(<DeleteAllThreadsDialog onDeleteAll={onDeleteAll} />)
    fireEvent.click(screen.getByText('common:deleteAll'))
    expect(screen.getByText('common:cancel')).toBeInTheDocument()
  })
})
