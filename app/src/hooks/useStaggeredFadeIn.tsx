import { createContext, useContext, useRef, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useAnimationStore } from '@/stores/animation-store'

type StaggeredAnimationContextValue = {
  getIndex: () => number
  delayMs: number
  initialDelayMs: number
  ready: boolean
  skipAnimation: boolean
}

const StaggeredAnimationContext = createContext<StaggeredAnimationContextValue>({
  getIndex: () => 0,
  delayMs: 12,
  initialDelayMs: 100,
  ready: false,
  skipAnimation: false,
})

type StaggeredAnimationProviderProps = {
  children: ReactNode
  delayMs?: number
  initialDelayMs?: number
  ready?: boolean
}

export function StaggeredAnimationProvider({
  children,
  delayMs = 12,
  initialDelayMs = 50,
  ready = true,
}: StaggeredAnimationProviderProps) {
  const indexRef = useRef(0)
  const sidebarAnimated = useAnimationStore((state) => state.sidebarAnimated)
  const setSidebarAnimated = useAnimationStore((state) => state.setSidebarAnimated)
  const [skipAnimation] = useState(() => sidebarAnimated)

  const getIndex = () => indexRef.current++

  // Mark as animated once ready becomes true
  useEffect(() => {
    if (ready && !sidebarAnimated) {
      setSidebarAnimated()
    }
  }, [ready, sidebarAnimated, setSidebarAnimated])

  return (
    <StaggeredAnimationContext.Provider value={{ getIndex, delayMs, initialDelayMs, ready, skipAnimation }}>
      {children}
    </StaggeredAnimationContext.Provider>
  )
}

export function useStaggeredFadeIn(explicitIndex?: number) {
  const { getIndex, delayMs, initialDelayMs, ready, skipAnimation } = useContext(StaggeredAnimationContext)
  // Capture index on first render only, or use explicit index
  const [autoIndex] = useState(() => getIndex())
  const index = explicitIndex ?? autoIndex

  // If animation already played, show immediately without animation
  if (skipAnimation) {
    return {
      className: '',
      style: {},
    }
  }

  if (!ready) {
    return {
      className: 'opacity-0',
      style: {},
    }
  }

  return {
    className: 'animate-in fade-in duration-200 fill-mode-backwards',
    style: { animationDelay: `${initialDelayMs + index * delayMs}ms` },
  }
}
