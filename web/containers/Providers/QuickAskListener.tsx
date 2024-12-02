import { Fragment } from 'react'

import { useSetAtom } from 'jotai'

import { useDebouncedCallback } from 'use-debounce'

import { MainViewState } from '@/constants/screens'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'

const QuickAskListener: React.FC = () => {
  const { sendChatMessage } = useSendChatMessage()
  const setMainState = useSetAtom(mainViewStateAtom)

  const debounced = useDebouncedCallback((value) => {
    setMainState(MainViewState.Thread)
    sendChatMessage(value)
  }, 300)

  window.electronAPI?.onUserSubmitQuickAsk((_event: string, input: string) => {
    debounced(input)
  })

  return <Fragment></Fragment>
}

export default QuickAskListener
