'use client'

import { ReactNode } from 'react'

import { Provider, atom } from 'jotai'

type Props = {
  children: ReactNode
}

export const editPromptAtom = atom<string>('')
export const currentPromptAtom = atom<string>('')
export const fileUploadAtom = atom<FileInfo[]>([])
export const appDownloadProgress = atom<number>(-1)
export const searchAtom = atom<string>('')

export default function JotaiWrapper({ children }: Props) {
  return <Provider>{children}</Provider>
}

export type FileType = 'image' | 'pdf'

export type FileInfo = {
  file: File
  type: FileType
}
