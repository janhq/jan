import { useEffect } from 'react'

export function usePageLeave(onPageLeave: () => void) {
  useEffect(() => {
    document.documentElement.addEventListener('mouseleave', onPageLeave)
    return () =>
      document.documentElement.removeEventListener('mouseleave', onPageLeave)
  }, [])
}
