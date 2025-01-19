import { Fragment, useEffect } from 'react'

import { useAtomValue, useSetAtom } from 'jotai'

import { useDebouncedCallback } from 'use-debounce'

import { MainViewState } from '@/constants/screens'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { quickAskEnabledAtom } from '@/helpers/atoms/AppConfig.atom'

const QuickAskListener: React.FC = () => {
  const { sendChatMessage } = useSendChatMessage()
  const setMainState = useSetAtom(mainViewStateAtom)
  const quickAskEnabled = useAtomValue(quickAskEnabledAtom)

  const debounced = useDebouncedCallback((value) => {
    setMainState(MainViewState.Thread)
    sendChatMessage(value)
  }, 300)

  window.electronAPI?.onUserSubmitQuickAsk((_event: string, input: string) => {
    debounced(input)
  })

  useEffect(() => {
    if (quickAskEnabled) {
      window.core?.api?.createSystemTray()
    }
  }, [quickAskEnabled])

  return <Fragment></Fragment>
}

export default QuickAskListener
