import { useEffect } from 'react'

const addBodyClass = (className: string) =>
  document.body.classList.add(className)
const removeBodyClass = (className: string) =>
  document.body.classList.remove(className)

export function useBodyClass(className: unknown) {
  useEffect(() => {
    // Set up
    className instanceof Array
      ? className.map(addBodyClass)
      : addBodyClass(className as string)

    // Clean up
    return () => {
      className instanceof Array
        ? className.map(removeBodyClass)
        : removeBodyClass(className as string)
    }
  }, [className])
}
