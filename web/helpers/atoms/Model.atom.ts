import { atom } from 'jotai'

export const selectedModelAtom = atom<AssistantModel | undefined>(undefined)

export const activeAssistantModelAtom = atom<AssistantModel | undefined>(
  undefined
)
