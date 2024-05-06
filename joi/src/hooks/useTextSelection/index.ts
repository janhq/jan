import { useEffect, useState } from 'react'

import { useReducer } from 'react'

const reducer = (value: number) => (value + 1) % 1000000

export function useTextSelection(): Selection | null {
  const [, update] = useReducer(reducer, 0)
  const [selection, setSelection] = useState<Selection | null>(null)

  const handleSelectionChange = () => {
    setSelection(document.getSelection())
    update()
  }

  useEffect(() => {
    setSelection(document.getSelection())
    document.addEventListener('selectionchange', handleSelectionChange)
    return () =>
      document.removeEventListener('selectionchange', handleSelectionChange)
  }, [])

  return selection
}
