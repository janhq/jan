import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueuedMessageChip } from '../QueuedMessageBubble'

describe('QueuedMessageChip', () => {
  const baseMessage = {
    id: 'queued-1',
    text: 'This is a queued message',
    createdAt: Date.now(),
  }

  it('renders the message text', () => {
    render(<QueuedMessageChip message={baseMessage} />)
    expect(screen.getByText('This is a queued message')).toBeInTheDocument()
  })

  it('renders the pulsing clock icon', () => {
    const { container } = render(<QueuedMessageChip message={baseMessage} />)
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('calls onRemove with the message id when X is clicked', () => {
    const onRemove = vi.fn()
    const { container } = render(
      <QueuedMessageChip message={baseMessage} onRemove={onRemove} />
    )
    container.querySelector('button')?.click()
    expect(onRemove).toHaveBeenCalledWith('queued-1')
  })

  it('does not render X button when onRemove is not provided', () => {
    const { container } = render(<QueuedMessageChip message={baseMessage} />)
    expect(container.querySelector('button')).toBeNull()
  })

  it('calls onEdit with the full message when text is clicked', () => {
    const onEdit = vi.fn()
    render(<QueuedMessageChip message={baseMessage} onEdit={onEdit} />)
    screen.getByText('This is a queued message').click()
    expect(onEdit).toHaveBeenCalledWith(baseMessage)
  })
})
