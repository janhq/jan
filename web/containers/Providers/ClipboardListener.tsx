import { Fragment, PropsWithChildren } from 'react'

import { useSetAtom } from 'jotai'

import { selectedTextAtom } from './Jotai'

const ClipboardListener = ({ children }: PropsWithChildren) => {
  const setSelectedText = useSetAtom(selectedTextAtom)

  window?.electronAPI?.onSelectedText((_event: string, text: string) => {
    setSelectedText(text)
  })

  return <Fragment>{children}</Fragment>
}

export default ClipboardListener
