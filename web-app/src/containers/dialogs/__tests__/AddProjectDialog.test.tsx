import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AddProjectDialog from '../AddProjectDialog'

const mocks = vi.hoisted(() => ({
  folders: [] as { id: string; name: string }[],
  success: vi.fn(), error: vi.fn(), warning: vi.fn(),
}))
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({ folders: mocks.folders }),
}))
vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({ assistants: [{ id: 'helper', name: 'Helper' }], addAssistant: vi.fn() }),
}))
vi.mock('../AddEditAssistant', () => ({ default: () => null }))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('sonner', () => ({ toast: mocks }))

function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const key = (suffix: string) => `projects.addProjectDialog.${suffix}`
const nameInput = () => screen.getByRole('textbox')
const saveButton = (editing = false) => screen.getByRole('button', { name: key(editing ? 'updateButton' : 'createButton') })
const enterName = (name: string) => fireEvent.change(nameInput(), { target: { value: name } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.folders = []
})

describe('AddProjectDialog persistence', () => {
  it('waits for creation, locks controls and dismissal, and prevents repeat click/Enter submissions', async () => {
    const pending = deferred()
    const onSave = vi.fn(() => pending.promise)
    const onOpenChange = vi.fn()
    render(<AddProjectDialog open editingKey={null} onSave={onSave} onOpenChange={onOpenChange} />)
    enterName('  Draft  ')
    fireEvent.click(saveButton())
    expect(onSave).toHaveBeenCalledWith('Draft', undefined)
    expect(nameInput()).toHaveValue('  Draft  ')
    expect(nameInput()).toBeDisabled()
    expect(saveButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: key('selectAssistant') })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'cancel' })).toBeDisabled()
    fireEvent.click(saveButton())
    fireEvent.keyDown(nameInput(), { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    await act(async () => pending.resolve())
    expect(mocks.success).toHaveBeenCalledWith(key('createSuccess'))
    expect(nameInput()).toHaveValue('')
    expect(nameInput()).toBeEnabled()
  })

  it('retains an edited draft and assistant on rejection, then allows retry and resets only on success', async () => {
    const pending = deferred()
    const onSave = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(undefined)
    const onOpenChange = vi.fn()
    render(<AddProjectDialog open editingKey="project" initialData={{ id: 'project', name: 'Original', updated_at: 1, assistantId: 'helper' }} onSave={onSave} onOpenChange={onOpenChange} />)
    enterName('Updated')
    fireEvent.keyDown(nameInput(), { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('Updated', 'helper')
    expect(mocks.success).not.toHaveBeenCalled()
    await act(async () => pending.reject(new Error('disk unavailable')))
    expect(mocks.error).toHaveBeenCalledTimes(1)
    expect(mocks.success).not.toHaveBeenCalled()
    expect(nameInput()).toHaveValue('Updated')
    expect(screen.getByRole('button', { name: 'Helper' })).toBeEnabled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(saveButton(true)).toBeEnabled()
    fireEvent.click(saveButton(true))
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith(key('updateSuccess')))
    expect(onSave).toHaveBeenNthCalledWith(2, 'Updated', 'helper')
    expect(nameInput()).toHaveValue('')
    expect(screen.getByRole('button', { name: key('selectAssistant') })).toBeInTheDocument()
  })

  it('catches synchronous throws and preserves a newly selected assistant', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => { throw new Error('write failed') })
    render(<AddProjectDialog open editingKey={null} onSave={onSave} onOpenChange={vi.fn()} />)
    enterName('Draft')
    await user.click(screen.getByRole('button', { name: key('selectAssistant') }))
    await user.click(screen.getByRole('menuitem', { name: 'Helper' }))
    fireEvent.click(saveButton())
    await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1))
    expect(nameInput()).toHaveValue('Draft')
    expect(screen.getByRole('button', { name: 'Helper' })).toBeEnabled()
    expect(onSave).toHaveBeenCalledWith('Draft', 'helper')
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('supports synchronous saves without duplicate reentrant submissions', async () => {
    const onSave = vi.fn(() => { fireEvent.keyDown(nameInput(), { key: 'Enter' }) })
    render(<AddProjectDialog open editingKey={null} onSave={onSave} onOpenChange={vi.fn()} />)
    enterName('Draft')
    fireEvent.click(saveButton())
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith(key('createSuccess')))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(nameInput()).toHaveValue('')
  })

  it('keeps validation for blank, unchanged, and duplicate names, excluding the edited project', async () => {
    const onSave = vi.fn()
    mocks.folders = [{ id: 'project', name: 'Original' }, { id: 'other', name: 'Taken' }]
    render(<AddProjectDialog open editingKey="project" initialData={{ id: 'project', name: 'Original', updated_at: 1 }} onSave={onSave} onOpenChange={vi.fn()} />)
    expect(saveButton(true)).toBeDisabled()
    enterName('   ')
    fireEvent.keyDown(nameInput(), { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
    enterName(' taken ')
    fireEvent.click(saveButton(true))
    expect(mocks.warning).toHaveBeenCalledWith(key('alreadyExists'))
    expect(onSave).not.toHaveBeenCalled()
    enterName('ORIGINAL')
    fireEvent.click(saveButton(true))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('ORIGINAL', undefined))
    expect(mocks.success).toHaveBeenCalledWith(key('updateSuccess'))
  })
})
