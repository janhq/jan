import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AssistantAvatar } from '../AssistantAvatar'

describe('AssistantAvatar', () => {
  it('centers emoji in a non-shrinking 16px slot without a text baseline offset', () => {
    render(<AssistantAvatar avatar="😀" />)
    const emoji = screen.getByText('😀')
    expect(emoji).toHaveClass('leading-none')
    expect(emoji.parentElement).toHaveClass('size-4', 'shrink-0', 'items-center', 'justify-center')
  })

  it('uses the same slot for image and absent-avatar fallback', () => {
    const { container, rerender } = render(<AssistantAvatar avatar="/images/avatar.png" />)
    expect(screen.getByRole('img')).toHaveClass('size-4', 'object-contain')
    const slot = container.firstElementChild
    rerender(<AssistantAvatar />)
    expect(container.firstElementChild).toBe(slot)
    expect(container.querySelector('svg')).toHaveAttribute('width', '16')
    expect(container.querySelector('svg')).toHaveAttribute('height', '16')
  })
})
