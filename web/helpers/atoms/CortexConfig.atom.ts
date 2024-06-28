import { atom } from 'jotai'

export type CortexConfig = {
  dataFolderPath: string
  initialized: boolean
  cortexCppHost: string
  cortexCppPort: number
  mistral: {
    apiKey: string
  }
  openai: {
    apiKey: string
  }
  groq: {
    apiKey: string
  }
}

const cortexConfigAtom = atom<CortexConfig | undefined>(undefined)

export const getCortexConfigAtom = atom((get) => get(cortexConfigAtom))

export const setCortexConfigAtom = atom(
  null,
  (get, set, value: CortexConfig) => {
    set(cortexConfigAtom, value)
  }
)
