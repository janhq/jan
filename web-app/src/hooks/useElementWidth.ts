import { useEffect, useRef, useState } from 'react'

/**
 * Tracks the rendered width of an element via ResizeObserver. `width` is null
 * until the first measurement, and 0 in environments without layout (jsdom),
 * so callers gate responsive collapse on a positive value.
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}
