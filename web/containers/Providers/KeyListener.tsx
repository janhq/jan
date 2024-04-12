'use client'

import { Fragment, ReactNode, useEffect } from 'react'

import { atom, useAtomValue, useSetAtom } from 'jotai'

import { MainViewState } from '@/constants/screens'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'

type Props = {
  children: ReactNode
}

export const showLeftSideBarAtom = atom<boolean>(true)
export const showSelectModelModalAtom = atom<boolean>(false)
export const showCommandSearchModalAtom = atom<boolean>(false)

export default function KeyListener({ children }: Props) {
  const setShowLeftSideBar = useSetAtom(showLeftSideBarAtom)
  const setShowSelectModelModal = useSetAtom(showSelectModelModalAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const showCommandSearchModal = useSetAtom(showCommandSearchModalAtom)
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
        setShowLeftSideBar((showLeftSideBar) => !showLeftSideBar)
        return
      }

      if (e.key === 'e' && prefixKey) {
        setShowSelectModelModal((show) => !show)
        return
      }

      if (e.key === ',' && prefixKey) {
        setMainViewState(MainViewState.Settings)
        return
      }

      if (e.key === 'k' && prefixKey) {
        showCommandSearchModal((show) => !show)
        return
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [
    assistants,
    requestCreateNewThread,
    setMainViewState,
    setShowLeftSideBar,
    setShowSelectModelModal,
    showCommandSearchModal,
  ])

  return <Fragment>{children}</Fragment>
}
