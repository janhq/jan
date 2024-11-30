'use client'

import { Fragment, useEffect } from 'react'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { MainViewState } from '@/constants/screens'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import { useStarterScreen } from '@/hooks/useStarterScreen'

import {
  mainViewStateAtom,
  showLeftPanelAtom,
  showRightPanelAtom,
} from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import {
  activeThreadAtom,
  modalActionThreadAtom,
  ThreadModalAction,
} from '@/helpers/atoms/Thread.atom'

export default function KeyListener() {
  const setShowLeftPanel = useSetAtom(showLeftPanelAtom)
  const setShowRightPanel = useSetAtom(showRightPanelAtom)
  const [mainViewState, setMainViewState] = useAtom(mainViewStateAtom)
  const { requestCreateNewThread } = useCreateNewThread()
  const assistants = useAtomValue(assistantsAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const setModalActionThread = useSetAtom(modalActionThreadAtom)
  const { isShowStarterScreen } = useStarterScreen()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const prefixKey = isMac ? e.metaKey : e.ctrlKey

      if (e.code === 'KeyB' && prefixKey && e.shiftKey) {
        setShowRightPanel((showRightideBar) => !showRightideBar)
        return
      }

      if (e.code === 'Backspace' && prefixKey && e.shiftKey) {
        if (!activeThread || mainViewState !== MainViewState.Thread) return
        setModalActionThread({
          showModal: ThreadModalAction.Delete,
          thread: activeThread,
        })
        return
      }

      if (e.code === 'KeyC' && prefixKey && e.shiftKey) {
        if (!activeThread || mainViewState !== MainViewState.Thread) return
        setModalActionThread({
          showModal: ThreadModalAction.Clean,
          thread: activeThread,
        })
        return
      }

      if (e.code === 'KeyN' && prefixKey && !isShowStarterScreen) {
        if (mainViewState !== MainViewState.Thread) return
        requestCreateNewThread(assistants[0])
        setMainViewState(MainViewState.Thread)
        return
      }

      if (e.code === 'KeyB' && prefixKey) {
        setShowLeftPanel((showLeftSideBar) => !showLeftSideBar)
        return
      }

      if (e.code === 'Comma' && prefixKey) {
        setMainViewState(MainViewState.Settings)
        return
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [
    activeThread,
    assistants,
    isShowStarterScreen,
    mainViewState,
    requestCreateNewThread,
    setMainViewState,
    setModalActionThread,
    setShowLeftPanel,
    setShowRightPanel,
  ])

  return <Fragment></Fragment>
}
