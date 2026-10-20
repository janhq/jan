import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { DeleteAllThreadsDialog } from '../dialogs/DeleteAllThreadsDialog'
import { DeleteAllThreadsInProjectDialog } from '../dialogs/DeleteAllThreadsInProjectDialog'
import { DeleteProjectDialog } from '../dialogs/DeleteProjectDialog'

const mock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), navigate: vi.fn(), deleteProject: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: mock.success, error: mock.error } }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mock.navigate }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useThreads', () => ({ useThreads: (selector: (state: { threads: object }) => unknown) => selector({ threads: {} }) }))
vi.mock('@/hooks/useThreadManagement', () => ({ useThreadManagement: () => ({ deleteFolderWithThreads: mock.deleteProject }) }))
vi.mock('@/components/ui/dropdown-menu', async () => {
  const { forwardRef } = await import('react')
  return { DropdownMenuItem: forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    ({ children, ...props }, ref) => <button ref={ref} {...props}>{children}</button>
  ) }
})

beforeEach(() => { vi.clearAllMocks() })

it.each(['all', 'project'] as const)('%s bulk dialogue waits for persistence and permits retry after failure', async (kind) => {
  let reject!: (error: Error) => void
  const onDeleteAll = vi.fn(() => new Promise<void>((_, r) => { reject = r }))
  const onDropdownClose = vi.fn()
  render(kind === 'all'
    ? <DeleteAllThreadsDialog onDeleteAll={onDeleteAll} onDropdownClose={onDropdownClose} />
    : <DeleteAllThreadsInProjectDialog projectName="Example" threadCount={2} onDeleteAll={onDeleteAll} onDropdownClose={onDropdownClose} />)
  fireEvent.click(screen.getByRole('button', { name: 'common:deleteAll' }))
  const confirm = screen.getAllByRole('button', { name: 'common:deleteAll' }).at(-1)!
  fireEvent.click(confirm)
  expect(confirm).toBeDisabled()
  expect(mock.success).not.toHaveBeenCalled()
  expect(onDropdownClose).not.toHaveBeenCalled()
  fireEvent.click(confirm)
  expect(onDeleteAll).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('disk denied')))
  expect(mock.error).toHaveBeenCalled()
  expect(confirm).not.toBeDisabled()
  expect(onDropdownClose).not.toHaveBeenCalled()
  expect(mock.success).not.toHaveBeenCalled()
})

it('project deletion blocks repeated confirmation and retains dialog after failure', async () => {
  let reject!: (error: Error) => void
  mock.deleteProject.mockImplementation(() => new Promise<void>((_, r) => { reject = r }))
  const onOpenChange = vi.fn()
  render(<DeleteProjectDialog open projectId="project" projectName="Example" onOpenChange={onOpenChange} />)
  const confirm = screen.getByRole('button', { name: 'projects.deleteProjectDialog.ariaLabel' })
  fireEvent.click(confirm)
  expect(confirm).toBeDisabled()
  expect(onOpenChange).not.toHaveBeenCalled()
  fireEvent.click(confirm)
  expect(mock.deleteProject).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('disk denied')))
  expect(mock.error).toHaveBeenCalled()
  expect(confirm).not.toBeDisabled()
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(mock.success).not.toHaveBeenCalled()
})
