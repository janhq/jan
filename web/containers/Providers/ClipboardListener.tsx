import { Fragment, PropsWithChildren } from 'react'

import { useSetAtom } from 'jotai'

import { selectedTextAtom } from './Jotai'

const ClipboardListener = ({ children }: PropsWithChildren) => {
  const setSelectedText = useSetAtom(selectedTextAtom)

  if (typeof window !== 'undefined') {
    window?.electronAPI?.onSelectedText((_event: string, text: string) => {
      setSelectedText(text)
    })
  }

  return <Fragment>{children}</Fragment>
}

export default ClipboardListener
