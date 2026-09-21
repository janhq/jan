import '@testing-library/jest-dom/vitest'
import { createRef, type HTMLAttributes, type ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LucideIcon } from 'lucide-react'

const motionState = vi.hoisted(() => ({
  reduced: false,
  start: vi.fn(),
}))

vi.mock('motion/react', () => ({
  motion: {
    div: (
      props: HTMLAttributes<HTMLDivElement> & {
        animate?: unknown
        variants?: unknown
        children?: ReactNode
      }
    ) => {
      const { animate, variants, children, ...rest } = props
      void animate
      void variants
      return <div {...rest}>{children}</div>
    },
  },
  useAnimation: () => ({ start: motionState.start }),
  useReducedMotion: () => motionState.reduced,
}))

import {
  AnimatedLucideIcon,
  type AnimatedLucideIconHandle,
} from '../animated-lucide'

const MockIcon = (({ size }: { size?: number }) => (
  <svg aria-label="mock icon" height={size} width={size} />
)) as LucideIcon

describe('AnimatedLucideIcon', () => {
  beforeEach(() => {
    motionState.reduced = false
    motionState.start.mockReset()
  })

  it('renders the supplied icon and exposes start/stop controls', () => {
    const ref = createRef<AnimatedLucideIconHandle>()

    render(
      <AnimatedLucideIcon
        ref={ref}
        icon={MockIcon}
        preset="box"
        size={16}
        data-testid="icon-wrapper"
      />
    )

    expect(screen.getByTestId('icon-wrapper')).toContainElement(
      screen.getByLabelText('mock icon')
    )
    expect(screen.getByLabelText('mock icon')).toHaveAttribute('width', '16')

    act(() => ref.current?.startAnimation())
    act(() => ref.current?.stopAnimation())

    expect(motionState.start).toHaveBeenNthCalledWith(1, 'animate')
    expect(motionState.start).toHaveBeenNthCalledWith(2, 'normal')
  })

  it('self-animates on hover when the caller supplies no ref', () => {
    render(
      <AnimatedLucideIcon
        icon={MockIcon}
        preset="home"
        data-testid="icon-wrapper"
      />
    )

    fireEvent.mouseEnter(screen.getByTestId('icon-wrapper'))
    fireEvent.mouseLeave(screen.getByTestId('icon-wrapper'))

    expect(motionState.start).toHaveBeenNthCalledWith(1, 'animate')
    expect(motionState.start).toHaveBeenNthCalledWith(2, 'normal')
  })

  it('does not start transforms when reduced motion is enabled', () => {
    motionState.reduced = true
    const ref = createRef<AnimatedLucideIconHandle>()

    render(<AnimatedLucideIcon ref={ref} icon={MockIcon} preset="home" />)

    act(() => ref.current?.startAnimation())

    expect(motionState.start).not.toHaveBeenCalledWith('animate')
  })
})
