import { create } from 'zustand'

import type { BrowserSelectionAttachment } from '@/types/attachment'

export type BrowserTargetBackend = 'in-app-preview' | 'chrome-cdp' | 'codex-runtime'

export type BrowserTargetCapabilities = {
  canNavigate: boolean
  canInspectDom: boolean
  canScreenshot: boolean
  canAct: boolean
}

export type BrowserRuntimeTarget = {
  id: string
  label: string
  backend: BrowserTargetBackend
  url: string
  title?: string
  updatedAt: number
  capabilities: BrowserTargetCapabilities
  selection?: BrowserSelectionAttachment['selection']
}

type BrowserRuntimeState = {
  targets: Record<string, BrowserRuntimeTarget>
  activeTargetId: string | null
  registerTarget: (target: BrowserRuntimeTarget) => void
  updateTarget: (
    targetId: string,
    update: Partial<Omit<BrowserRuntimeTarget, 'id'>>
  ) => void
  setActiveTarget: (targetId: string | null) => void
  removeTarget: (targetId: string) => void
  setSelection: (
    targetId: string,
    selection: BrowserSelectionAttachment['selection'] | undefined
  ) => void
  getActiveTarget: () => BrowserRuntimeTarget | undefined
}

export const useBrowserRuntime = create<BrowserRuntimeState>()((set, get) => ({
  targets: {},
  activeTargetId: null,

  registerTarget: (target) => {
    set((state) => ({
      targets: {
        ...state.targets,
        [target.id]: target,
      },
      activeTargetId: state.activeTargetId ?? target.id,
    }))
  },

  updateTarget: (targetId, update) => {
    set((state) => {
      const current = state.targets[targetId]
      if (!current) return state

      return {
        targets: {
          ...state.targets,
          [targetId]: {
            ...current,
            ...update,
            updatedAt: Date.now(),
          },
        },
      }
    })
  },

  setActiveTarget: (activeTargetId) => set({ activeTargetId }),

  removeTarget: (targetId) => {
    set((state) => {
      const { [targetId]: removedTarget, ...targets } = state.targets
      const activeTargetId =
        state.activeTargetId === targetId
          ? (Object.keys(targets)[0] ?? null)
          : state.activeTargetId

      return removedTarget ? { targets, activeTargetId } : state
    })
  },

  setSelection: (targetId, selection) => {
    get().updateTarget(targetId, { selection })
  },

  getActiveTarget: () => {
    const state = get()
    return state.activeTargetId ? state.targets[state.activeTargetId] : undefined
  },
}))
