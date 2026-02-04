import { useEffect, useState, useCallback } from 'react'

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

const STORAGE_KEY = 'claude-code-helper-models'

const defaultModels: ClaudeCodeModels = {
  big: null,
  medium: null,
  small: null,
  envVars: [],
  customCli: '',
}

// Load from localStorage once
const loadFromStorage = (): ClaudeCodeModels => {
  if (typeof window === 'undefined') return defaultModels

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      // Validate the structure
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'big' in parsed &&
        'medium' in parsed &&
        'small' in parsed &&
        Array.isArray(parsed.envVars) &&
        typeof parsed.customCli === 'string'
      ) {
        return {
          big: parsed.big ?? null,
          medium: parsed.medium ?? null,
          small: parsed.small ?? null,
          envVars: parsed.envVars ?? [],
          customCli: parsed.customCli ?? '',
        }
      }
    }
  } catch {
    console.warn('Failed to load claude-code helper models from localStorage')
  }
  return defaultModels
}

export function useClaudeCodeModel() {
  const [models, setModels] = useState<ClaudeCodeModels>(loadFromStorage)

  // Save to localStorage - only when models actually changes
  const saveToStorage = useCallback((data: ClaudeCodeModels) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      console.warn('Failed to save claude-code helper models to localStorage')
    }
  }, [])

  const setModel = useCallback((type: ClaudeCodeModelType, modelId: string | null) => {
    setModels((prev) => {
      const newModels = { ...prev, [type]: modelId }
      saveToStorage(newModels)
      return newModels
    })
  }, [saveToStorage])

  const setEnvVars = useCallback((envVars: EnvVar[]) => {
    setModels((prev) => {
      const newModels = { ...prev, envVars }
      saveToStorage(newModels)
      return newModels
    })
  }, [saveToStorage])

  const setCustomCli = useCallback((customCli: string) => {
    setModels((prev) => {
      const newModels = { ...prev, customCli }
      saveToStorage(newModels)
      return newModels
    })
  }, [saveToStorage])

  const clearModels = useCallback(() => {
    setModels(defaultModels)
    saveToStorage(defaultModels)
  }, [saveToStorage])

  return {
    models,
    setModel,
    setEnvVars,
    setCustomCli,
    clearModels,
  }
}