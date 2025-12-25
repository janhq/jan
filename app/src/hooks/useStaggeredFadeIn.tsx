import { createContext, useContext, useRef, useState, ReactNode } from 'react'

type StaggeredAnimationContextValue = {
  getIndex: () => number
  delayMs: number
  initialDelayMs: number
  ready: boolean
}

const StaggeredAnimationContext = createContext<StaggeredAnimationContextValue>({
  getIndex: () => 0,
  delayMs: 12,
  initialDelayMs: 100,
  ready: false,
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

  const getIndex = () => indexRef.current++

  return (
    <StaggeredAnimationContext.Provider value={{ getIndex, delayMs, initialDelayMs, ready }}>
      {children}
    </StaggeredAnimationContext.Provider>
  )
}

export function useStaggeredFadeIn(explicitIndex?: number) {
  const { getIndex, delayMs, initialDelayMs, ready } = useContext(StaggeredAnimationContext)
  // Capture index on first render only, or use explicit index
  const [autoIndex] = useState(() => getIndex())
  const index = explicitIndex ?? autoIndex

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
