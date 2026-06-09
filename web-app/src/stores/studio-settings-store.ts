import { create } from 'zustand'

export type StudioSamplerSettings = {
  temperature: number
  topP: number
  topK: number
  repeatPenalty: number
  maxTokens: number
  seed: number
  stream: boolean
  jsonMode: boolean
}

export const defaultStudioSamplerSettings: StudioSamplerSettings = {
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  repeatPenalty: 1.1,
  maxTokens: 2048,
  seed: -1,
  stream: true,
  jsonMode: false,
}

type StudioSettingsState = {
  sampler: StudioSamplerSettings
  setSampler: (sampler: StudioSamplerSettings) => void
  updateSampler: (patch: Partial<StudioSamplerSettings>) => void
}

export const useStudioSettings = create<StudioSettingsState>()((set) => ({
  sampler: defaultStudioSamplerSettings,
  setSampler: (sampler) => set({ sampler }),
  updateSampler: (patch) =>
    set((state) => ({
      sampler: { ...state.sampler, ...patch },
    })),
}))
