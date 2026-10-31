import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SkillsManagerDialog from '../SkillsManagerDialog'

const mocks = vi.hoisted(() => ({
  sessions: [] as { id: string; folder: string | null }[],
  currentId: null as string | null,
  skills: [] as { name: string; description?: string; origin?: string }[],
  read: vi.fn(), write: vi.fn(), remove: vi.fn(), hubList: vi.fn(), hubImport: vi.fn(),
  success: vi.fn(), error: vi.fn(),
}))
vi.mock('@/hooks/useSkills', () => ({ useSkills: () => mocks }))
vi.mock('@/hooks/useCoworkSessions', () => ({
  useCoworkSessions: (selector: (state: unknown) => unknown) => selector(mocks),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }))

const show = () => render(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  mocks.sessions = []
  mocks.currentId = null
  mocks.skills = []
  mocks.read.mockResolvedValue('Existing instructions')
  mocks.write.mockResolvedValue(undefined)
  mocks.remove.mockResolvedValue(undefined)
  mocks.hubList.mockResolvedValue([{ name: 'research', description: 'Research helper' }])
  mocks.hubImport.mockResolvedValue(undefined)
})

describe('SkillsManagerDialog', () => {
  it('shows a single compact empty state, with both actions in a shared toolbar', () => {
    show()
    expect(screen.getByText('common:skillsEmpty')).toBeVisible()
    expect(screen.getAllByText('common:skillsPickOrNew')).toHaveLength(1)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    const create = screen.getByRole('button', { name: 'common:skillNew' })
    expect(create.parentElement).toBe(screen.getByRole('button', { name: 'common:skillHubImport' }).parentElement)
    expect(create.parentElement).toHaveClass('flex-wrap')
    expect(screen.getByRole('dialog')).not.toHaveTextContent('common:skillHubTitle')
  })

  it('creates and saves a draft, without an empty sidebar', async () => {
    show()
    click('common:skillNew')
    expect(screen.queryByText('common:skillsEmpty')).not.toBeInTheDocument()
    const name = screen.getByRole('textbox', { name: 'common:skillNamePlaceholder' })
    const content = screen.getByRole('textbox', { name: 'common:skillContentPlaceholder' })
    expect(content).toHaveValue('---\nname: \ndescription: \n---\n\n')
    fireEvent.change(name, { target: { value: ' writing ' } })
    fireEvent.change(content, { target: { value: 'Write clearly' } })
    click('common:skillSave')
    await waitFor(() => expect(mocks.write).toHaveBeenCalledWith('writing', 'Write clearly'))
    await waitFor(() => expect(name).toBeDisabled())
    click('common:cancel')
    expect(screen.getByText('common:skillsEmpty')).toBeVisible()
  })

  it('keeps a draft open on save failure and validates its name', async () => {
    show()
    click('common:skillNew')
    click('common:skillSave')
    expect(mocks.error).toHaveBeenCalledWith('common:skillNameRequired')
    expect(mocks.write).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: 'common:skillNamePlaceholder' }), { target: { value: 'draft' } })
    mocks.write.mockRejectedValueOnce(new Error('Save failed'))
    click('common:skillSave')
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Error: Save failed'))
    expect(screen.getByRole('textbox', { name: 'common:skillNamePlaceholder' })).toBeEnabled()
  })

  it('opens, edits, and deletes existing skills using accessible buttons', async () => {
    mocks.skills = [{ name: 'writing', description: 'Writing helper' }]
    const view = show()
    expect(screen.getByText('common:skillsPickOrNew')).toBeVisible()
    click('writing Writing helper')
    const content = await screen.findByDisplayValue('Existing instructions')
    expect(screen.getByRole('textbox', { name: 'common:skillNamePlaceholder' })).toBeDisabled()
    fireEvent.change(content, { target: { value: 'Updated instructions' } })
    click('common:skillSave')
    await waitFor(() => expect(mocks.write).toHaveBeenCalledWith('writing', 'Updated instructions'))
    click('common:skillDelete: writing')
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('writing'))
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    mocks.skills = []
    view.rerender(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByText('common:skillsEmpty')).toBeVisible()
  })

  it('browses, imports and reimports hub skills, and can switch back to creating', async () => {
    const view = show()
    click('common:skillHubImport')
    expect(await screen.findByText('Research helper')).toBeVisible()
    click('common:skillImport')
    await waitFor(() => expect(mocks.hubImport).toHaveBeenCalledWith('research'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'common:skillImport' })).toBeEnabled())
    mocks.skills = [{ name: 'research' }]
    view.rerender(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
    click('common:skillReimport')
    await waitFor(() => expect(mocks.hubImport).toHaveBeenCalledTimes(2))
    click('common:skillNew')
    expect(screen.queryByText('common:skillHubTitle')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'common:skillNamePlaceholder' })).toHaveValue('')
  })
})

// Scope changes must replace the owner of async callbacks, not just clear the
// visible text: a deferred read can otherwise restore the old scope's draft.
describe('SkillsManagerDialog scope isolation', () => {
  const switchFolder = (folder: string | null) => {
    mocks.sessions = [{ id: 'current', folder }]
    mocks.currentId = 'current'
  }

  it('resets drafts on global/folder changes, but preserves them within the same folder and on reopen', () => {
    const view = show()
    click('common:skillNew')
    fireEvent.change(screen.getByRole('textbox', { name: 'common:skillContentPlaceholder' }), { target: { value: 'Global draft' } })
    switchFolder('/a')
    view.rerender(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    click('common:skillNew')
    fireEvent.change(screen.getByRole('textbox', { name: 'common:skillContentPlaceholder' }), { target: { value: 'Folder draft' } })
    mocks.sessions.push({ id: 'same-folder', folder: '/a' })
    mocks.currentId = 'same-folder'
    view.rerender(<SkillsManagerDialog open={false} onOpenChange={vi.fn()} />)
    view.rerender(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'common:skillContentPlaceholder' })).toHaveValue('Folder draft')
    switchFolder('/b')
    view.rerender(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    click('common:skillNew')
    switchFolder(null)
    view.rerender(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('ignores an old-folder read even after switching away and back', async () => {
    let resolveRead!: (value: string) => void
    mocks.read.mockReturnValueOnce(new Promise<string>((resolve) => { resolveRead = resolve }))
    mocks.skills = [{ name: 'writing' }]
    switchFolder('/a')
    const view = show()
    click('writing common:skillOriginGlobal')
    switchFolder('/b')
    view.rerender(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
    switchFolder('/a')
    view.rerender(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
    click('common:skillNew')
    await act(async () => { resolveRead('Old scope instructions') })
    expect(screen.getByRole('textbox', { name: 'common:skillNamePlaceholder' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'common:skillContentPlaceholder' })).not.toHaveValue('Old scope instructions')
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('discards old hub loads and resets an in-flight import on scope change', async () => {
    let resolveList!: (value: { name: string; description: string }[]) => void
    mocks.hubList.mockReturnValueOnce(new Promise((resolve) => { resolveList = resolve }))
    const view = show()
    click('common:skillHubImport')
    switchFolder('/a')
    view.rerender(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
    expect(screen.queryByText('common:skillHubTitle')).not.toBeInTheDocument()
    await act(async () => { resolveList([{ name: 'stale', description: 'Old hub result' }]) })
    click('common:skillHubImport')
    expect(await screen.findByText('Research helper')).toBeVisible()
    expect(screen.queryByText('Old hub result')).not.toBeInTheDocument()
    let resolveImport!: () => void
    mocks.hubImport.mockReturnValueOnce(new Promise<void>((resolve) => { resolveImport = resolve }))
    click('common:skillImport')
    expect(screen.getByRole('button', { name: 'common:skillImport' })).toBeDisabled()
    switchFolder('/b')
    view.rerender(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
    click('common:skillHubImport')
    expect(await screen.findByRole('button', { name: 'common:skillImport' })).toBeEnabled()
    await act(async () => { resolveImport() })
    expect(screen.getByRole('button', { name: 'common:skillImport' })).toBeEnabled()
  })
})
