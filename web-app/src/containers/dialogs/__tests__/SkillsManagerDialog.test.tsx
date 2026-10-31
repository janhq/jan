import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SkillsManagerDialog from '../SkillsManagerDialog'

const mocks = vi.hoisted(() => ({
  sessions: [] as { id: string; folder: string | null }[],
  currentId: null as string | null,
  skills: [] as { name: string; description?: string; origin?: string }[],
  read: vi.fn(), write: vi.fn(), remove: vi.fn(), hubList: vi.fn(), hubImport: vi.fn(),
  success: vi.fn(), error: vi.fn(), scope: vi.fn(),
  writeDestination: vi.fn(), importDestination: vi.fn(),
}))
vi.mock('@/hooks/useSkills', () => ({
  useSkills: (folder: string | null) => {
    mocks.scope(folder)
    return {
      ...mocks,
      write: (...args: unknown[]) => {
        mocks.writeDestination(folder)
        return mocks.write(...args)
      },
      hubImport: (...args: unknown[]) => {
        mocks.importDestination(folder)
        return mocks.hubImport(...args)
      },
    }
  },
}))
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
    await waitFor(() => expect(mocks.write).toHaveBeenCalledWith('writing', 'Write clearly', true))
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
    await waitFor(() => expect(mocks.write).toHaveBeenCalledWith('writing', 'Updated instructions', false))
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

const changeScope = (value: string) => fireEvent.change(screen.getByRole('combobox'), { target: { value } })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('SkillsManagerDialog scope and async isolation', () => {
  beforeEach(() => {
    mocks.sessions = [{ id: 'current', folder: '/a' }]
    mocks.currentId = 'current'
  })

  it('defaults to Global after folder Cowork, always offers Global and freezes context while open', () => {
    const view = show()
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(mocks.scope).toHaveBeenLastCalledWith(null)
    changeScope('/a')
    expect(mocks.scope).toHaveBeenLastCalledWith('/a')
    mocks.sessions = [{ id: 'current', folder: '/b' }]
    view.rerender(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('combobox')).toHaveValue('/a')
    changeScope('')
    expect(mocks.scope).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('option', { name: 'common:skillOriginGlobal' })).toBeVisible()
  })

  it.each(['/b', null])('resets an unavailable closed scope to Global when context becomes %s', async (nextFolder) => {
    const view = show()
    changeScope('/a')
    click('common:skillNew')
    fireEvent.change(screen.getByRole('textbox', { name: 'common:skillContentPlaceholder' }), { target: { value: 'Old folder draft' } })
    view.rerender(<SkillsManagerDialog open={false} onOpenChange={vi.fn()} />)
    mocks.sessions = [{ id: 'current', folder: nextFolder }]
    view.rerender(<SkillsManagerDialog open={false} onOpenChange={vi.fn()} />)
    expect(mocks.scope).toHaveBeenLastCalledWith(null)
    view.rerender(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(nextFolder ? ['', nextFolder] : [''])
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    click('common:skillNew')
    fireEvent.change(screen.getByRole('textbox', { name: 'common:skillNamePlaceholder' }), { target: { value: 'global-draft' } })
    click('common:skillSave')
    await waitFor(() => expect(mocks.write).toHaveBeenCalled())
    expect(mocks.writeDestination).toHaveBeenLastCalledWith(null)
    await waitFor(() => expect(screen.getByRole('button', { name: 'common:skillHubImport' })).toBeEnabled())
    click('common:skillHubImport')
    await screen.findByText('Research helper')
    click('common:skillImport')
    await waitFor(() => expect(mocks.hubImport).toHaveBeenCalledWith('research'))
    expect(mocks.importDestination).toHaveBeenLastCalledWith(null)
  })

  it('preserves the selected scope and draft across a same-context external close', () => {
    const view = show()
    changeScope('/a')
    click('common:skillNew')
    fireEvent.change(screen.getByRole('textbox', { name: 'common:skillContentPlaceholder' }), { target: { value: 'Same folder draft' } })
    view.rerender(<SkillsManagerDialog open={false} onOpenChange={vi.fn()} />)
    view.rerender(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('combobox')).toHaveValue('/a')
    expect(screen.getByDisplayValue('Same folder draft')).toBeVisible()
    expect(mocks.scope).toHaveBeenLastCalledWith('/a')
  })

  it('guards a dirty scope switch and resets the draft only after discard', () => {
    show()
    click('common:skillNew')
    fireEvent.change(screen.getByRole('textbox', { name: 'common:skillContentPlaceholder' }), { target: { value: 'Draft' } })
    changeScope('/a')
    expect(screen.getByText('common:skillsDiscardTitle')).toBeVisible()
    const buttons = screen.getAllByRole('button', { name: 'common:cancel' })
    fireEvent.click(buttons[buttons.length - 1])
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(screen.getByDisplayValue('Draft')).toBeVisible()
    changeScope('/a')
    click('common:skillsDiscard')
    expect(screen.getByRole('combobox')).toHaveValue('/a')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('ignores a late A read after B is selected', async () => {
    const a = deferred<string>()
    mocks.skills = [{ name: 'A' }, { name: 'B' }]
    mocks.read.mockReturnValueOnce(a.promise).mockResolvedValueOnce('B body')
    show()
    click('A')
    click('B')
    expect(await screen.findByDisplayValue('B body')).toBeVisible()
    await act(async () => { a.resolve('A body') })
    expect(screen.getByDisplayValue('B body')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'common:skillNamePlaceholder' })).toHaveValue('B')
  })

  it.each(['new', 'cancel'])('ignores a late read after %s', async (destination) => {
    const a = deferred<string>()
    mocks.skills = [{ name: 'A' }, { name: 'B' }]
    const view = show()
    if (destination === 'cancel') {
      click('B')
      await screen.findByDisplayValue('Existing instructions')
    }
    mocks.read.mockReturnValueOnce(a.promise)
    click('A')
    if (destination === 'new') click('common:skillNew')
    else click('common:cancel')
    await act(async () => { a.resolve('A body') })
    expect(screen.queryByDisplayValue('A body')).not.toBeInTheDocument()
    if (destination === 'new') expect(screen.getByRole('textbox', { name: 'common:skillNamePlaceholder' })).toBeEnabled()
    else expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    view.unmount()
  })

  it('locks navigation, scope and editing while save is pending', async () => {
    const save = deferred<void>()
    mocks.skills = [{ name: 'A' }, { name: 'B' }]
    mocks.write.mockReturnValueOnce(save.promise)
    show()
    click('A')
    await screen.findByDisplayValue('Existing instructions')
    click('common:skillSave')
    expect(screen.getByRole('combobox')).toBeDisabled()
    for (const name of ['B', 'common:skillNew', 'common:skillHubImport', 'common:cancel']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
      click(name)
    }
    expect(screen.getByRole('textbox', { name: 'common:skillContentPlaceholder' })).toBeDisabled()
    await act(async () => { save.resolve() })
    expect(screen.getByRole('textbox', { name: 'common:skillNamePlaceholder' })).toHaveValue('A')
    expect(mocks.read).toHaveBeenCalledTimes(1)
    expect(mocks.write).toHaveBeenCalledWith('A', 'Existing instructions', false)
  })

  it('guards dirty New navigation and discards only after explicit confirmation', async () => {
    mocks.skills = [{ name: 'A' }]
    show()
    click('A')
    const content = await screen.findByDisplayValue('Existing instructions')
    fireEvent.change(content, { target: { value: 'Unsaved A' } })
    click('common:skillNew')
    expect(screen.getByText('common:skillsDiscardTitle')).toBeVisible()
    click('common:skillsDiscard')
    expect(screen.getByRole('textbox', { name: 'common:skillNamePlaceholder' })).toHaveValue('')
    expect(screen.queryByDisplayValue('Unsaved A')).not.toBeInTheDocument()
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('cannot restore a saved selection after an external close and reopen', async () => {
    const save = deferred<void>()
    mocks.skills = [{ name: 'A' }, { name: 'B' }]
    mocks.write.mockReturnValueOnce(save.promise)
    const view = show()
    click('A')
    await screen.findByDisplayValue('Existing instructions')
    click('common:skillSave')
    view.rerender(<SkillsManagerDialog open={false} onOpenChange={vi.fn()} />)
    view.rerender(<SkillsManagerDialog open onOpenChange={vi.fn()} />)
    await act(async () => { save.resolve() })
    click('B')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'common:skillNamePlaceholder' })).toHaveValue('B'))
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('isolates old-scope reads when switching away and back', async () => {
    const a = deferred<string>()
    mocks.skills = [{ name: 'A' }]
    mocks.read.mockReturnValueOnce(a.promise)
    show()
    click('A')
    changeScope('/a')
    changeScope('')
    click('common:skillNew')
    await act(async () => { a.resolve('Old scope') })
    expect(screen.queryByDisplayValue('Old scope')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'common:skillNamePlaceholder' })).toBeEnabled()
  })
})
