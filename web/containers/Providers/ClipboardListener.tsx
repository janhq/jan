/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fragment, PropsWithChildren, useCallback, useEffect } from 'react'

import { useSetAtom } from 'jotai'

import { currentPromptAtom } from './Jotai'

const ClipboardListener = ({ children }: PropsWithChildren) => {
  const setCurrentPrompt = useSetAtom(currentPromptAtom)

  const onSelectedText = useCallback(
    (text: any) => {
      console.log('received selected text')
      console.log(text)
      setCurrentPrompt(text)
    },
    [setCurrentPrompt]
  )

  useEffect(() => {
    if (window && window.electronAPI) {
      window.electronAPI.onSelectedText((_event: string, text: string) =>
        onSelectedText(text)
      )
    }
    return () => {}
  }, [onSelectedText])

  return <Fragment>{children}</Fragment>
}

export default ClipboardListener
