import { Fragment } from 'react'

import { useSetAtom } from 'jotai'

import { selectedTextAtom } from './Jotai'

const ClipboardListener = () => {
  const setSelectedText = useSetAtom(selectedTextAtom)

  if (typeof window !== 'undefined') {
    window?.electronAPI?.onSelectedText((_event: string, text: string) => {
      setSelectedText(text)
    })
  }

  return <Fragment></Fragment>
}

export default ClipboardListener
