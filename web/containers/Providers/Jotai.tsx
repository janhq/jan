'use client'

import { PropsWithChildren } from 'react'

import { Provider, atom } from 'jotai'

import { FileInfo } from '@/types/file'

export const editPromptAtom = atom<string>('')
export const currentPromptAtom = atom<string>('')
export const fileUploadAtom = atom<FileInfo | undefined>()

export const searchAtom = atom<string>('')

export const selectedTextAtom = atom('')

export default function JotaiWrapper({ children }: PropsWithChildren) {
  return <Provider>{children}</Provider>
}
