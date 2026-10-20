/**
 * Store for @path file/folder references in chat input.
 * Maintains an ordered list of active references during a message composition.
 */
import { create } from 'zustand'
import type { PathReference } from '@/types/path-reference'

type PathReferencesState = {
  /** Active references in the current message being composed */
  references: PathReference[]

  /** Set all references (from parsing the prompt text) */
  setReferences: (refs: PathReference[]) => void

  /** Add a single reference */
  addReference: (ref: PathReference) => void

  /** Remove a reference by its raw path */
  removeReference: (rawPath: string) => void

  /** Clear all references */
  clearReferences: () => void

  /** Get the current references */
  getReferences: () => PathReference[]
}

export const usePathReferences = create<PathReferencesState>((set, get) => ({
  references: [],

  setReferences: (refs) => set({ references: refs }),

  addReference: (ref) =>
    set((state) => {
      // Avoid duplicates
      if (state.references.some((r) => r.rawPath === ref.rawPath)) return state
      return { references: [...state.references, ref] }
    }),

  removeReference: (rawPath) =>
    set((state) => ({
      references: state.references.filter((r) => r.rawPath !== rawPath),
    })),

  clearReferences: () => set({ references: [] }),

  getReferences: () => get().references,
}))
