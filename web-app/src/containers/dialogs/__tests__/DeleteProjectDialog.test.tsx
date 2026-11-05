import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import en from '@/locales/en/common.json'

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  viewedProjectId: undefined as string | undefined,
  deleteFolderWithThreads: vi.fn(),
  threads: {} as Record<string, unknown>,
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => h.navigate,
  useParams: ({ select }: { select?: (p: unknown) => unknown }) => {
    const params = { projectId: h.viewedProjectId }
    return select ? select(params) : params
  },
}))
// Resolve against the real English bundle (with count plurals) so the copy is under test.
const t = (key: string, opts: { count?: number; projectName?: string } = {}) => {
  const dialog = en.projects.deleteProjectDialog as Record<string, string>
  const leaf = key.replace('projects.deleteProjectDialog.', '')
  const raw =
    opts.count !== undefined && dialog[`${leaf}_${opts.count === 1 ? 'one' : 'other'}`] !== undefined
      ? dialog[`${leaf}_${opts.count === 1 ? 'one' : 'other'}`]
      : (dialog[leaf] ?? key)
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => String((opts as Record<string, unknown>)[k] ?? ''))
}
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({ deleteFolderWithThreads: h.deleteFolderWithThreads }),
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: (select: (s: unknown) => unknown) => select({ threads: h.threads }),
}))

import { DeleteProjectDialog } from '../DeleteProjectDialog'

const confirm = async (projectId = 'p1') => {
  const onOpenChange = vi.fn()
  render(
    <DeleteProjectDialog
      open
      onOpenChange={onOpenChange}
      projectId={projectId}
      projectName="Alpha"
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha' }))
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
}

beforeEach(() => {
  h.navigate.mockClear()
  h.deleteFolderWithThreads.mockReset().mockResolvedValue(undefined)
  h.viewedProjectId = undefined
})

describe('DeleteProjectDialog navigation', () => {
  it('leaves the project page when the viewed project is deleted', async () => {
    h.viewedProjectId = 'p1'
    await confirm('p1')
    expect(h.deleteFolderWithThreads).toHaveBeenCalledWith('p1')
    expect(h.navigate).toHaveBeenCalledTimes(1)
    expect(h.navigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('stays put when a project is deleted from the sidebar on another page', async () => {
    h.viewedProjectId = undefined
    await confirm('p1')
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('stays put when another project page is open', async () => {
    h.viewedProjectId = 'p2'
    await confirm('p1')
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('does not navigate when the delete fails', async () => {
    h.viewedProjectId = 'p1'
    h.deleteFolderWithThreads.mockRejectedValue(new Error('boom'))
    const onOpenChange = vi.fn()
    render(<DeleteProjectDialog open onOpenChange={onOpenChange} projectId="p1" projectName="Alpha" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha' }))
    await waitFor(() => expect(h.deleteFolderWithThreads).toHaveBeenCalled())
    await Promise.resolve()
    expect(h.navigate).not.toHaveBeenCalled()
  })
})

describe('DeleteProjectDialog copy', () => {
  it('names the project and its conversation count', () => {
    h.threads = {
      a: { metadata: { project: { id: 'p1' } } },
      b: { metadata: { project: { id: 'p1' } } },
      c: { metadata: { project: { id: 'other' } } },
    }
    render(<DeleteProjectDialog open onOpenChange={vi.fn()} projectId="p1" projectName="Alpha" />)
    expect(screen.getByRole('dialog')).toHaveTextContent('permanently delete "Alpha" and its 2 conversations')
    h.threads = {}
  })

  it('uses the singular for one conversation', () => {
    h.threads = { a: { metadata: { project: { id: 'p1' } } } }
    render(<DeleteProjectDialog open onOpenChange={vi.fn()} projectId="p1" projectName="Alpha" />)
    expect(screen.getByRole('dialog')).toHaveTextContent('"Alpha" and its 1 conversation.')
    h.threads = {}
  })
})
