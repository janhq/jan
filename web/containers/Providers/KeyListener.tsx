'use client'

import { Fragment, ReactNode, useEffect } from 'react'

import { atom, useSetAtom } from 'jotai'

import { MainViewState } from '@/constants/screens'

import { useMainViewState } from '@/hooks/useMainViewState'

type Props = {
  children: ReactNode
}

export const showLeftSideBarAtom = atom<boolean>(true)
export const showSelectModelModalAtom = atom<boolean>(false)
export const showCommandSearchModalAtom = atom<boolean>(false)

export default function KeyListener({ children }: Props) {
  const setShowLeftSideBar = useSetAtom(showLeftSideBarAtom)
  const setShowSelectModelModal = useSetAtom(showSelectModelModalAtom)
  const { setMainViewState } = useMainViewState()
  const showCommandSearchModal = useSetAtom(showCommandSearchModalAtom)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const prefixKey = isMac ? e.metaKey : e.ctrlKey

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <Fragment>{children}</Fragment>
}
