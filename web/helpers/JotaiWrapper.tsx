'use client'

import { ReactNode } from 'react'

import { Provider, atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

type Props = {
  children: ReactNode
}

export default function JotaiWrapper({ children }: Props) {
  return <Provider>{children}</Provider>
}

export const currentPromptAtom = atom<string>('')
export const appDownloadProgress = atom<number>(-1)
export const searchingModelText = atom<string>('')
export const searchAtom = atom<string>('')
export const modelSearchAtom = atom<string>('')
export const userConfigs = atomWithStorage<UserConfig>('config', {
  gettingStartedShow: false,
  sidebarLeftExpand: false,
  accent: 'accent-blue',
})
