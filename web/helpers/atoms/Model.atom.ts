import { atom } from 'jotai'

export const stateModel = atom({ state: 'start', loading: false, model: '' })
export const selectedModelAtom = atom<AssistantModel | undefined>(undefined)
export const activeAssistantModelAtom = atom<AssistantModel | undefined>(
  undefined
)
