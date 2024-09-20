import { useEffect, useRef } from 'react'

const DEFAULT_EVENTS = ['mousedown', 'touchstart']

export function useClickOutside<T extends HTMLElement = any>(
  handler: () => void,
  events?: string[] | null,
  nodes?: (HTMLElement | null)[]
) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const listener = (event: Event) => {
      const target = event.target as HTMLElement

      // Check if the target or any ancestor has the data-ignore-outside-clicks attribute
      const shouldIgnore =
        target.closest('[data-ignore-outside-clicks]') !== null

      if (Array.isArray(nodes)) {
        const shouldTrigger = nodes.every(
          (node) => !!node && !event.composedPath().includes(node)
        )
        if (shouldTrigger && !shouldIgnore) {
          handler()
        }
      } else if (
        ref.current &&
        !ref.current.contains(target) &&
        !shouldIgnore
      ) {
        handler()
      }
    }

    const eventList = events || DEFAULT_EVENTS
    eventList.forEach((event) =>
      document.documentElement.addEventListener(event, listener)
    )

    return () => {
      eventList.forEach((event) =>
        document.documentElement.removeEventListener(event, listener)
      )
    }
  }, [handler, nodes, events])

  return ref
}
