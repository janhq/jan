import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'

export interface UseMediaQueryOptions {
  getInitialValueInEffect: boolean
}

type MediaQueryCallback = (event: { matches: boolean; media: string }) => void

// Zustand store for small screen state
type SmallScreenState = {
  isSmallScreen: boolean
  setIsSmallScreen: (isSmall: boolean) => void
}

export const useSmallScreenStore = create<SmallScreenState>((set) => ({
  isSmallScreen: false,
  setIsSmallScreen: (isSmall) => set({ isSmallScreen: isSmall }),
}))

/**
 * Older versions of Safari (shipped withCatalina and before) do not support addEventListener on matchMedia
 * https://stackoverflow.com/questions/56466261/matchmedia-addlistener-marked-as-deprecated-addeventlistener-equivalent
 * */
function attachMediaListener(
  query: MediaQueryList,
  callback: MediaQueryCallback
) {
  try {
    query.addEventListener('change', callback)
    return () => query.removeEventListener('change', callback)
  } catch (e) {
    console.warn(e)
    // eslint-disable @typescript-eslint/no-deprecated
    query.addListener(callback)
    return () => query.removeListener(callback)
    // eslint-enable @typescript-eslint/no-deprecated
  }
}

function getInitialValue(query: string, initialValue?: boolean) {
  if (typeof initialValue === 'boolean') {
    return initialValue
  }

  if (typeof window !== 'undefined' && 'matchMedia' in window) {
    return window.matchMedia(query).matches
  }

  return false
}

export function useMediaQuery(
  query: string,
  initialValue?: boolean,
  { getInitialValueInEffect }: UseMediaQueryOptions = {
    getInitialValueInEffect: true,
  }
): boolean {
  const [matches, setMatches] = useState(
    getInitialValueInEffect ? initialValue : getInitialValue(query)
  )
  const queryRef = useRef<MediaQueryList>(null)

  useEffect(() => {
    if ('matchMedia' in window) {
      queryRef.current = window.matchMedia(query)
      setMatches(queryRef.current.matches)
      return attachMediaListener(queryRef.current, (event) =>
        setMatches(event.matches)
      )
    }

    return undefined
  }, [query])

  return matches || false
}

// Specific hooks for different screen sizes
export const useSmallScreen = (): boolean => {
  return useMediaQuery('(max-width: 768px)')
}

export const useMobileScreen = (): boolean => {
  return useMediaQuery('(max-width: 640px)')
}

export const useTabletScreen = (): boolean => {
  return useMediaQuery('(min-width: 641px) and (max-width: 1024px)')
}

export const useDesktopScreen = (): boolean => {
  return useMediaQuery('(min-width: 1025px)')
}

// Orientation detection
export const usePortrait = (): boolean => {
  return useMediaQuery('(orientation: portrait)')
}

export const useLandscape = (): boolean => {
  return useMediaQuery('(orientation: landscape)')
}

// Touch device detection
export const useTouchDevice = (): boolean => {
  return useMediaQuery('(pointer: coarse)')
}
