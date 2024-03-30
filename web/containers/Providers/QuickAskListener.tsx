import { Fragment, ReactNode } from 'react'

import { useSetAtom } from 'jotai'

import { useDebouncedCallback } from 'use-debounce'

import { MainViewState } from '@/constants/screens'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'

type Props = {
  children: ReactNode
}

const QuickAskListener: React.FC<Props> = ({ children }) => {
  const { sendChatMessage } = useSendChatMessage()
  const setMainState = useSetAtom(mainViewStateAtom)

  const debounced = useDebouncedCallback((value) => {
    setMainState(MainViewState.Thread)
    sendChatMessage(value)
  }, 300)

  window.electronAPI?.onUserSubmitQuickAsk((_event: string, input: string) => {
    debounced(input)
  })

  return <Fragment>{children}</Fragment>
}

export default QuickAskListener
