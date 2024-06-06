import { useSetAtom } from 'jotai'

import { useDebouncedCallback } from 'use-debounce'

import { MainViewState } from '@/constants/screens'

import useSendMessage from '@/hooks/useSendMessage'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'

const QuickAskListener: React.FC = () => {
  const { sendMessage } = useSendMessage()
  const setMainState = useSetAtom(mainViewStateAtom)

  const debounced = useDebouncedCallback((value) => {
    setMainState(MainViewState.Thread)
    sendMessage(value)
  }, 300)

  window.electronAPI?.onUserSubmitQuickAsk((_event: string, input: string) => {
    debounced(input)
  })

  return null
}

export default QuickAskListener
