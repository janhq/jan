import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { FailedDraftCard } from '../FailedDraftCard'

const draft = {
  id: 'fd-1',
  text: 'my message',
  attachments: [{ name: 'a.pdf', type: 'document' }] as never,
  createdAt: 1,
}

describe('FailedDraftCard', () => {
  it('shows the text and file count and acts only on click', () => {
    const onRestore = vi.fn()
    const onDismiss = vi.fn()
    render(
      <FailedDraftCard draft={draft} onRestore={onRestore} onDismiss={onDismiss} />
    )
    expect(screen.getByText('my message')).toBeInTheDocument()
    expect(screen.getByText(/1 file/)).toBeInTheDocument()
    expect(onRestore).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Restore draft' }))
    expect(onRestore).toHaveBeenCalledWith(draft)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledWith('fd-1')
  })
})
