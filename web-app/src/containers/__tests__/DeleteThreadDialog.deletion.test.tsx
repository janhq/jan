import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { DeleteThreadDialog } from '../dialogs/DeleteThreadDialog'

const mock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), navigate: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: mock.success, error: mock.error } }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mock.navigate }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

beforeEach(() => { vi.clearAllMocks() })

it('keeps dialog open and suppresses repeated confirmation while deletion is pending', async () => {
  let resolve!: () => void
  const onDelete = vi.fn(() => new Promise<void>(r => { resolve = r }))
  const onOpenChange = vi.fn()
  render(<DeleteThreadDialog thread={{ id: 'a', title: 'Chat', updated: 1 }} open withoutTrigger onOpenChange={onOpenChange} onDelete={onDelete} variant="project" />)
  const button = screen.getByTestId('confirm-delete-thread')
  fireEvent.click(button)
  expect(onDelete).toHaveBeenCalledTimes(1)
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(mock.success).not.toHaveBeenCalled()
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(onDelete).toHaveBeenCalledTimes(1)
  await act(async () => resolve())
  expect(onOpenChange).toHaveBeenCalledWith(false)
  expect(mock.success).toHaveBeenCalledOnce()
})

it('preserves dialog for retry and displays backend failure', async () => {
  const onOpenChange = vi.fn()
  render(<DeleteThreadDialog thread={{ id: 'a', title: 'Chat', updated: 1 }} open withoutTrigger onOpenChange={onOpenChange} onDelete={() => Promise.reject(new Error('Permission denied'))} variant="project" />)
  await act(async () => fireEvent.click(screen.getByTestId('confirm-delete-thread')))
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(mock.success).not.toHaveBeenCalled()
  expect(mock.error).toHaveBeenCalled()
  expect(screen.getByTestId('confirm-delete-thread')).not.toBeDisabled()
})
