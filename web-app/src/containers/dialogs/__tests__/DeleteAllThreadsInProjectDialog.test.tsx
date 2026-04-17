import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DeleteAllThreadsInProjectDialog } from '../DeleteAllThreadsInProjectDialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}))

function renderInDropdown(ui: React.ReactElement) {
  return render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>trigger</DropdownMenuTrigger>
      <DropdownMenuContent>{ui}</DropdownMenuContent>
    </DropdownMenu>
  )
}

describe('DeleteAllThreadsInProjectDialog', () => {
  const onDeleteAll = vi.fn()
  const onDropdownClose = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('renders trigger', () => {
    renderInDropdown(
      <DeleteAllThreadsInProjectDialog
        projectName="Test Project"
        threadCount={5}
        onDeleteAll={onDeleteAll}
      />
    )
    expect(screen.getByText('common:deleteAll')).toBeInTheDocument()
  })

  it('opens dialog on click', () => {
    renderInDropdown(
      <DeleteAllThreadsInProjectDialog
        projectName="Test Project"
        threadCount={5}
        onDeleteAll={onDeleteAll}
      />
    )
    fireEvent.click(screen.getByText('common:deleteAll'))
    expect(screen.getByText('common:dialogs.deleteAllThreadsInProject.title')).toBeInTheDocument()
  })

  it('calls onDeleteAll and onDropdownClose on delete', () => {
    renderInDropdown(
      <DeleteAllThreadsInProjectDialog
        projectName="Test"
        threadCount={3}
        onDeleteAll={onDeleteAll}
        onDropdownClose={onDropdownClose}
      />
    )
    fireEvent.click(screen.getByText('common:deleteAll'))
    fireEvent.click(screen.getByRole('button', { name: 'common:deleteAll' }))
    expect(onDeleteAll).toHaveBeenCalled()
    expect(onDropdownClose).toHaveBeenCalled()
  })
})
