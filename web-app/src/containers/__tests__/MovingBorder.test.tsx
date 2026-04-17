import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, style }: any) => <div data-testid="motion-div" style={style}>{children}</div>,
  },
  useAnimationFrame: vi.fn(),
  useMotionTemplate: (...args: any[]) => 'translateX(0px) translateY(0px)',
  useMotionValue: () => ({ set: vi.fn(), get: () => 0 }),
  useTransform: () => 0,
}))

import { MovingBorder } from '../MovingBorder'

describe('MovingBorder', () => {
  it('renders children and SVG', () => {
    render(<MovingBorder>Content</MovingBorder>)
    expect(screen.getByText('Content')).toBeInTheDocument()
    expect(screen.getByTestId('motion-div')).toBeInTheDocument()
  })

  it('renders SVG rect', () => {
    const { container } = render(<MovingBorder rx="4" ry="4">Test</MovingBorder>)
    const rect = container.querySelector('rect')
    expect(rect).toBeInTheDocument()
    expect(rect?.getAttribute('rx')).toBe('4')
  })
})
