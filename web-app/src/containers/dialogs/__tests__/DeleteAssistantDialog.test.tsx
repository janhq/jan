import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DeleteAssistantDialog } from '../DeleteAssistantDialog'
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())
it('keeps a rejected deletion open and permits retry without duplicate pending submissions', async () => {
  let reject!: (error: Error) => void
  const pending = new Promise<void>((_, fail) => { reject = fail })
  void pending.catch(() => {})
  const confirm = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(undefined)
  const close = vi.fn()
  render(<DeleteAssistantDialog open onOpenChange={close} onConfirm={confirm} />)
  const button = screen.getByRole('button', { name: 'assistants:delete' })
  fireEvent.click(button)
  expect(button).toBeDisabled()
  fireEvent.keyDown(button, { key: 'Enter' })
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(close).not.toHaveBeenCalled()
  await act(async () => reject(new Error('file locked')))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('assistants:deleteFailed'))
  expect(button).not.toBeDisabled()
  fireEvent.click(button)
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
})
it('supports synchronous confirm callbacks', async () => {
  const confirm = vi.fn()
  render(<DeleteAssistantDialog open onOpenChange={vi.fn()} onConfirm={confirm} />)
  fireEvent.click(screen.getByRole('button', { name: 'assistants:delete' }))
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
})
