import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import { localStorageKey } from '@/constants/localStorage'
import { defaultAssistant } from '@/hooks/useAssistant'

/**
 * Global sampling parameters.
 *
 * Sampling (temperature / top_p / top_k / min_p / penalties + optional
 * max_output_tokens) used to live per-assistant in `assistant.parameters`.
 * It is now a single application-wide bag, edited in the model-bar Sampling
 * popover and injected verbatim into every local-backend chat request by
 * `custom-chat-transport`. Only keys actually present are sent, so an
 * untouched parameter keeps the backend default (matching prior behavior).
 *
 * Seed: the built-in default assistant's parameters, so the historical
 * defaults survive the move off the assistant.
 *
 * `userOverridden` flips to true the moment the user edits any value in the
 * Sampling popover. It gates model-family recommended defaults (e.g. Gemma 4
 * QAT temp/top_p/top_k) applied at request time in `custom-chat-transport`:
 * recommended values are layered on only while the user has not tuned
 * sampling themselves, so an explicit choice is never silently overridden.
 */
interface SamplingSettingsState {
  params: Record<string, unknown>
  userOverridden: boolean
  setParam: (key: string, value: unknown) => void
  setParams: (params: Record<string, unknown>) => void
  getParams: () => Record<string, unknown>
}

export const useSamplingSettings = create<SamplingSettingsState>()(
  persist(
    (set, get) => ({
      params: { ...(defaultAssistant.parameters ?? {}) },
      userOverridden: false,
      setParam: (key, value) =>
        set((state) => ({
          params: { ...state.params, [key]: value },
          userOverridden: true,
        })),
      setParams: (params) => set({ params, userOverridden: true }),
      getParams: () => get().params,
    }),
    {
      name: localStorageKey.samplingSettings,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        params: state.params,
        userOverridden: state.userOverridden,
      }),
    }
  )
)
