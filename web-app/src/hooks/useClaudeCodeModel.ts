import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { fileStorage } from '@/lib/fileStorage'

export type ClaudeCodeModelType = 'big' | 'medium' | 'small'

export interface EnvVar {
  key: string
  value: string
}

interface ClaudeCodeModels {
  big: string | null
  medium: string | null
  small: string | null
  envVars: EnvVar[]
  customCli: string
}

interface ClaudeCodeState {
  models: ClaudeCodeModels
  setModel: (type: ClaudeCodeModelType, modelId: string | null) => void
  setEnvVars: (envVars: EnvVar[]) => void
  setCustomCli: (customCli: string) => void
  clearModels: () => void
}

const defaultModels: ClaudeCodeModels = {
  big: null,
  medium: null,
  small: null,
  envVars: [],
  customCli: '',
}

const STORAGE_KEY = 'claude-code-helper-models'

export const useClaudeCodeModel = create<ClaudeCodeState>()(
  persist(
    (set, get) => ({
      models: defaultModels,

      setModel: (type, modelId) => {
        set({ models: { ...get().models, [type]: modelId } })
      },

      setEnvVars: (envVars) => {
        set({ models: { ...get().models, envVars } })
      },

      setCustomCli: (customCli) => {
        set({ models: { ...get().models, customCli } })
      },

      clearModels: () => {
        set({ models: defaultModels })
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => fileStorage),
    }
  )
)
