'use client'

import { PropsWithChildren } from 'react'

import { Provider, atom } from 'jotai'

export const editPromptAtom = atom<string>('')
export const currentPromptAtom = atom<string>('')
export const fileUploadAtom = atom<FileInfo[]>([])

export const searchAtom = atom<string>('')

export const selectedTextAtom = atom('')

export default function JotaiWrapper({ children }: PropsWithChildren) {
  return <Provider>{children}</Provider>
}

export type FileType = 'image' | 'pdf'

export type FileInfo = {
  file: File
  type: FileType
}
