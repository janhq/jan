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

// TODO: using react query for this
// TODO: update the object CortexConfig to be more dynamic for the engine
const cortexConfigAtom = atom<CortexConfig | undefined>(undefined)

export const getCortexConfigAtom = atom((get) => get(cortexConfigAtom))

export const setCortexConfigAtom = atom(
  null,
  (_get, set, value: CortexConfig) => {
    set(cortexConfigAtom, value)
  }
)
