'use client'

import type { LucideIcon } from 'lucide-react'
import type { Variants } from 'motion/react'
import { motion, useAnimation, useReducedMotion } from 'motion/react'
import type { HTMLAttributes, MouseEvent } from 'react'
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react'

import { cn } from '@/lib/utils'

export type AnimatedLucidePreset = 'home' | 'handshake' | 'box' | 'sliders'

export interface AnimatedLucideIconHandle {
  startAnimation: () => void
  stopAnimation: () => void
}

interface AnimatedLucideIconProps extends HTMLAttributes<HTMLDivElement> {
  icon: LucideIcon
  preset: AnimatedLucidePreset
  size?: number
}

const PRESETS: Record<AnimatedLucidePreset, Variants> = {
  home: {
    normal: { rotate: 0, y: 0 },
    animate: {
      rotate: [0, -5, 0],
      y: [0, -1, 0],
      transition: { duration: 0.45, ease: 'easeInOut' },
    },
  },
  handshake: {
    normal: { rotate: 0 },
    animate: {
      rotate: [0, -5, 5, 0],
      transition: { duration: 0.5, ease: 'easeInOut' },
    },
  },
  box: {
    normal: { rotate: 0 },
    animate: {
      rotate: [0, -7, 0],
      transition: { duration: 0.45, ease: 'easeInOut' },
    },
  },
  sliders: {
    normal: { x: 0 },
    animate: {
      x: [0, -1, 1, 0],
      transition: { duration: 0.45, ease: 'easeInOut' },
    },
  },
}

export const AnimatedLucideIcon = forwardRef<
  AnimatedLucideIconHandle,
  AnimatedLucideIconProps
>(function AnimatedLucideIcon(
  {
    icon: Icon,
    preset,
    onMouseEnter,
    onMouseLeave,
    className,
    size = 28,
    ...props
  },
  ref
) {
  const controls = useAnimation()
  const reducedMotion = useReducedMotion()
  const isControlledRef = useRef(false)

  useImperativeHandle(ref, () => {
    isControlledRef.current = true

    return {
      startAnimation: () => {
        if (!reducedMotion) void controls.start('animate')
      },
      stopAnimation: () => {
        void controls.start('normal')
      },
    }
  }, [controls, reducedMotion])

  const handleMouseEnter = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseEnter?.(event)
      } else if (!reducedMotion) {
        void controls.start('animate')
      }
    },
    [controls, onMouseEnter, reducedMotion]
  )

  const handleMouseLeave = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseLeave?.(event)
      } else {
        void controls.start('normal')
      }
    },
    [controls, onMouseLeave]
  )

  return (
    <div
      {...props}
      className={cn('inline-flex shrink-0', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div animate={controls} variants={PRESETS[preset]}>
        <Icon aria-hidden="true" size={size} />
      </motion.div>
    </div>
  )
})
