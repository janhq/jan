'use client'

import { ReactNode } from 'react'

import { Provider, atom } from 'jotai'

type Props = {
  children: ReactNode
}

export const currentPromptAtom = atom<string>('')
export const appDownloadProgress = atom<number>(-1)
export const searchingModelText = atom<string>('')
export const searchAtom = atom<string>('')
export const modelSearchAtom = atom<string>('')

export default function JotaiWrapper({ children }: Props) {
  return <Provider>{children}</Provider>
}
