import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Shimmer } from '../shimmer'

vi.mock('motion/react', () => ({
  motion: {
    create: vi.fn(
      (component: string) =>
        ({ children, className, style, animate, initial, transition, ...props }: any) => {
          const Tag = component as any
          return (
            <Tag className={className} style={style} data-testid="shimmer" {...props}>
              {children}
            </Tag>
          )
        }
    ),
  },
}))

describe('Shimmer', () => {
  it('renders text content', () => {
    render(<Shimmer>Loading text</Shimmer>)
    expect(screen.getByText('Loading text')).toBeInTheDocument()
  })

  it('renders with custom className', () => {
    render(<Shimmer className="custom-class">Test</Shimmer>)
    expect(screen.getByTestId('shimmer')).toHaveClass('custom-class')
  })
})
