import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DeleteAssistantDialog } from '../DeleteAssistantDialog'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('DeleteAssistantDialog persistence', () => {
  it('blocks repeated deletes and keeps confirmation open on failure', async () => {
    let reject!: (error: Error) => void
    const onConfirm = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
    const onOpenChange = vi.fn()
    render(<DeleteAssistantDialog open onConfirm={onConfirm} onOpenChange={onOpenChange} />)
    const button = screen.getByRole('button', { name: 'assistants:delete' })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    await act(async () => reject(new Error('Delete failed')))
    expect(await screen.findByRole('alert')).toHaveTextContent('Delete failed')
    expect(onOpenChange).not.toHaveBeenCalled()
    await waitFor(() => expect(button).not.toBeDisabled())
  })
})
