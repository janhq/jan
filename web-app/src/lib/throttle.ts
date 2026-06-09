export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number
): (...args: Args) => void {
  let lastRan = 0
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  return (...args: Args) => {
    const now = Date.now()
    const remaining = waitMs - (now - lastRan)

    if (remaining <= 0) {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
      lastRan = now
      fn(...args)
      return
    }

    if (timeoutId === undefined) {
      timeoutId = setTimeout(() => {
        timeoutId = undefined
        lastRan = Date.now()
        fn(...args)
      }, remaining)
    }
  }
}

export const FPS_60_MS = 1000 / 60

export function rafThrottle<Args extends unknown[]>(
  fn: (...args: Args) => void
): (...args: Args) => void {
  let rafId: number | null = null
  let pendingArgs: Args | null = null

  return (...args: Args) => {
    pendingArgs = args
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      if (pendingArgs !== null) {
        fn(...pendingArgs)
        pendingArgs = null
      }
    })
  }
}