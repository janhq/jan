import { Fragment, ReactNode, useRef } from 'react'

import { useSetAtom } from 'jotai'

import { MainViewState } from '@/constants/screens'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import { showRightSideBarAtom } from '@/screens/Chat/Sidebar'

import { showLeftSideBarAtom } from './KeyListener'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'

type Props = {
  children: ReactNode
}

const QuickAskListener: React.FC<Props> = ({ children }) => {
  const { sendChatMessage } = useSendChatMessage()
  const setShowRightSideBar = useSetAtom(showRightSideBarAtom)
  const setShowLeftSideBar = useSetAtom(showLeftSideBarAtom)
  const setMainState = useSetAtom(mainViewStateAtom)

  const previousMessage = useRef('')

  window.electronAPI.onUserSubmitQuickAsk((_event: string, input: string) => {
    if (previousMessage.current === input) return
    setMainState(MainViewState.Thread)
    setShowRightSideBar(false)
    setShowLeftSideBar(false)
    sendChatMessage(input)
    previousMessage.current = input
  })

  return <Fragment>{children}</Fragment>
}

export default QuickAskListener
