import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AddProjectDialog from '../AddProjectDialog'
import { toast } from 'sonner'

vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({ folders: [] }),
}))
vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistants: [{ id: 'assistant-1', name: 'Assistant One' }],
    addAssistant: vi.fn(),
  }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('../AddEditAssistant', () => ({ default: () => null }))
vi.mock('@/containers/AvatarEmoji', () => ({ AvatarEmoji: () => null }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

function pendingSave() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail })
  // Before the fix the callback's rejection is ignored; handle it here so
  // the failed regression does not leak an unhandled rejection to other tests.
  void promise.catch(() => {})
  return { promise, resolve, reject }
}

function mount(onSave: (name: string, assistantId?: string) => void | Promise<void>, editing = false) {
  const onOpenChange = vi.fn()
  render(<AddProjectDialog open onOpenChange={onOpenChange}
    editingKey={editing ? 'project-1' : null}
    initialData={editing ? { id: 'project-1', name: 'Old name', updated_at: 1, assistantId: 'assistant-1' } : undefined}
    onSave={onSave} />)
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'New name' } })
  return { input, button: screen.getByRole('button', { name: `projects.addProjectDialog.${editing ? 'updateButton' : 'createButton'}` }), onOpenChange }
}

describe('AddProjectDialog persistence', () => {
  it.each([false, true])('waits for persistence before clearing or reporting success (edit=%s)', async (editing) => {
    const save = pendingSave()
    const onSave = vi.fn(() => save.promise)
    const { input, button, onOpenChange } = mount(onSave, editing)
    fireEvent.click(button)
    expect(input).toHaveValue('New name')
    expect(toast.success).not.toHaveBeenCalled()
    expect(button).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => save.resolve())
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce())
    expect(input).toHaveValue('')
  })

  it.each([false, true])('keeps the draft and supports retry after a rejection (edit=%s)', async (editing) => {
    const save = pendingSave()
    const onSave = vi.fn().mockReturnValueOnce(save.promise).mockResolvedValueOnce(undefined)
    const { input, button } = mount(onSave, editing)
    fireEvent.click(button)
    await act(async () => save.reject(new Error('storage unavailable')))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('projects.addProjectDialog.saveError'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(input).toHaveValue('New name')
    expect(button).not.toBeDisabled()
    if (editing) expect(screen.getByText('Assistant One')).toBeInTheDocument()
    fireEvent.click(button)
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce())
    expect(onSave).toHaveBeenNthCalledWith(2, 'New name', editing ? 'assistant-1' : undefined)
  })

  it('handles synchronous callbacks', async () => {
    const onSave = vi.fn()
    const { button } = mount(onSave)
    fireEvent.click(button)
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce())
    expect(onSave).toHaveBeenCalledWith('New name', undefined)
  })
})
