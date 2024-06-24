import { atom } from 'jotai'

const modelHubSelectedModelHandle = atom<string | undefined>(undefined)

export const setModelHubSelectedModelHandle = atom(
  null,
  (_get, set, modelHandle: string) => {
    set(modelHubSelectedModelHandle, modelHandle)
  }
)

export const getModelHubSelectedModelHandle = atom((get) =>
  get(modelHubSelectedModelHandle)
)
