import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Avatar, AvatarFallback } from '../avatar'

describe('Avatar', () => {
  it('renders with default classes', () => {
    render(
      <Avatar data-testid="avatar">
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>
    )
    expect(screen.getByTestId('avatar')).toBeInTheDocument()
  })

  it('renders fallback text', () => {
    render(
      <Avatar>
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>
    )
    expect(screen.getByText('JD')).toBeInTheDocument()
  })

  it('accepts custom className', () => {
    render(
      <Avatar data-testid="avatar" className="custom-class">
        <AvatarFallback>A</AvatarFallback>
      </Avatar>
    )
    expect(screen.getByTestId('avatar')).toHaveClass('custom-class')
  })
})
