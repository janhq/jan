import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import en from '@/locales/en/common.json'

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: '/',
  deleteFolderWithThreads: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => h.navigate,
  useRouter: () => ({ state: { get location() { return { pathname: h.pathname } } } }),
}))
// Resolve against the real English bundle (with count plurals) so the copy is under test.
const t = (key: string, opts: { projectName?: string } = {}) => {
  const dialog = en.projects.deleteProjectDialog as Record<string, string>
  const raw = dialog[key.replace('projects.deleteProjectDialog.', '')] ?? key
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => String((opts as Record<string, unknown>)[k] ?? ''))
}
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({ deleteFolderWithThreads: h.deleteFolderWithThreads }),
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
  h.pathname = '/'
})

describe('DeleteProjectDialog navigation', () => {
  it('leaves the project page when the viewed project is deleted', async () => {
    h.pathname = '/project/p1'
    await confirm('p1')
    expect(h.deleteFolderWithThreads).toHaveBeenCalledWith('p1')
    expect(h.navigate).toHaveBeenCalledTimes(1)
    expect(h.navigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('stays put when a project is deleted from the sidebar on another page', async () => {
    h.pathname = '/threads/t1'
    await confirm('p1')
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('stays put when another project page is open', async () => {
    h.pathname = '/project/p2'
    await confirm('p1')
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('does not navigate when the delete fails', async () => {
    h.pathname = '/project/p1'
    h.deleteFolderWithThreads.mockRejectedValue(new Error('boom'))
    const onOpenChange = vi.fn()
    render(<DeleteProjectDialog open onOpenChange={onOpenChange} projectId="p1" projectName="Alpha" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha' }))
    await waitFor(() => expect(h.deleteFolderWithThreads).toHaveBeenCalled())
    await Promise.resolve()
    expect(h.navigate).not.toHaveBeenCalled()
  })
})

describe('DeleteProjectDialog route read after the delete', () => {
  const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>((r) => (resolve = r))
    return { promise, resolve }
  }

  it('does not navigate Home when the user left the deleted project while it ran', async () => {
    h.pathname = '/project/p1'
    const d = deferred()
    h.deleteFolderWithThreads.mockReturnValue(d.promise)
    const onOpenChange = vi.fn()
    render(<DeleteProjectDialog open onOpenChange={onOpenChange} projectId="p1" projectName="Alpha" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha' }))
    h.pathname = '/settings/general'
    d.resolve()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('navigates Home when the user opened the deleted project while it ran', async () => {
    h.pathname = '/threads/t1'
    const d = deferred()
    h.deleteFolderWithThreads.mockReturnValue(d.promise)
    const onOpenChange = vi.fn()
    render(<DeleteProjectDialog open onOpenChange={onOpenChange} projectId="p1" projectName="Alpha" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha' }))
    h.pathname = '/project/p1'
    d.resolve()
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith({ to: '/' }))
  })
})

describe('DeleteProjectDialog copy', () => {
  it('names the project and no conversation count', () => {
    render(<DeleteProjectDialog open onOpenChange={vi.fn()} projectId="p1" projectName="Alpha" />)
    const text = screen.getByRole('dialog').textContent ?? ''
    expect(text).toContain('permanently delete "Alpha" and all of its conversations')
    expect(text).not.toMatch(/\d+ conversation/)
  })
})
