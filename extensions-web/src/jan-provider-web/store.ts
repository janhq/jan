/**
 * Jan Provider Store
 * Zustand-based state management for Jan provider authentication and models
 */

import { create } from 'zustand'

export interface JanModel {
  id: string
  object: string
  owned_by: string
  created?: number
  capabilities: string[]
  supportedParameters?: string[]
}

export interface JanProviderState {
  isAuthenticated: boolean
  isInitializing: boolean
  models: JanModel[]
  isLoadingModels: boolean
  error: string | null
}

export interface JanProviderActions {
  setAuthenticated: (isAuthenticated: boolean) => void
  setInitializing: (isInitializing: boolean) => void
  setModels: (models: JanModel[]) => void
  setLoadingModels: (isLoadingModels: boolean) => void
  setError: (error: string | null) => void
  clearError: () => void
  reset: () => void
}

export type JanProviderStore = JanProviderState & JanProviderActions

const initialState: JanProviderState = {
  isAuthenticated: false,
  isInitializing: true,
  models: [],
  isLoadingModels: false,
  error: null,
}

export const useJanProviderStore = create<JanProviderStore>((set) => ({
  ...initialState,

  setAuthenticated: (isAuthenticated: boolean) =>
    set({ isAuthenticated, error: null }),

  setInitializing: (isInitializing: boolean) =>
    set({ isInitializing }),

  setModels: (models: JanModel[]) =>
    set({ models, isLoadingModels: false }),

  setLoadingModels: (isLoadingModels: boolean) =>
    set({ isLoadingModels }),

  setError: (error: string | null) =>
    set({ error }),

  clearError: () =>
    set({ error: null }),

  reset: () =>
    set({
      isAuthenticated: false,
      isInitializing: false,
      models: [],
      isLoadingModels: false,
      error: null,
    }),
}))

// Export a store instance for non-React usage
export const janProviderStore = {
  // Store access methods
  getState: useJanProviderStore.getState,
  setState: useJanProviderStore.setState,
  subscribe: useJanProviderStore.subscribe,
  
  // Direct action methods
  setAuthenticated: (isAuthenticated: boolean) =>
    useJanProviderStore.getState().setAuthenticated(isAuthenticated),
  setInitializing: (isInitializing: boolean) =>
    useJanProviderStore.getState().setInitializing(isInitializing),
  setModels: (models: JanModel[]) =>
    useJanProviderStore.getState().setModels(models),
  setLoadingModels: (isLoadingModels: boolean) =>
    useJanProviderStore.getState().setLoadingModels(isLoadingModels),
  setError: (error: string | null) =>
    useJanProviderStore.getState().setError(error),
  clearError: () =>
    useJanProviderStore.getState().clearError(),
  reset: () =>
    useJanProviderStore.getState().reset(),
}
