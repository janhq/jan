'use client'

import { Fragment, ReactNode, useEffect } from 'react'

import { useAtomValue, useSetAtom } from 'jotai'

import { MainViewState } from '@/constants/screens'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import { mainViewStateAtom, showLeftPanelAtom } from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'

type Props = {
  children: ReactNode
}

export default function KeyListener({ children }: Props) {
  const setShowLeftPanel = useSetAtom(showLeftPanelAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const { requestCreateNewThread } = useCreateNewThread()
  const assistants = useAtomValue(assistantsAtom)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const prefixKey = isMac ? e.metaKey : e.ctrlKey

      if (e.key === 'n' && prefixKey) {
        requestCreateNewThread(assistants[0])
        setMainViewState(MainViewState.Thread)
        return
      }

      if (e.key === 'b' && prefixKey) {
        setShowLeftPanel((showLeftSideBar) => !showLeftSideBar)
        return
      }

      if (e.key === ',' && prefixKey) {
        setMainViewState(MainViewState.Settings)
        return
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [assistants, requestCreateNewThread, setMainViewState, setShowLeftPanel])

  return <Fragment>{children}</Fragment>
}
