'use client'

import { ReactNode } from 'react'

import { Provider, atom } from 'jotai'

type Props = {
  children: ReactNode
}

export const currentPromptAtom = atom<string>('')
export const currentFileAtom = atom<File | undefined | null>(undefined)
export const appDownloadProgress = atom<number>(-1)
export const searchAtom = atom<string>('')

export default function JotaiWrapper({ children }: Props) {
  return <Provider>{children}</Provider>
}
