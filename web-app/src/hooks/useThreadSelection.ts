/**
 * @description Thread multi-select state management hook
 * @module hooks/useThreadSelection
 * @since 1.0.0
 */

import { create } from 'zustand'

interface ThreadSelectionState {
  /**
   * Set of selected thread IDs
   */
  selectedThreadIds: Set<string>

  /**
   * Selection mode (whether multi-select UI is active)
   */
  isSelectionMode: boolean

  /**
   * Last selected thread ID (for shift-click range selection)
   */
  lastSelectedId: string | null

  /**
   * Toggle selection mode on/off
   */
  toggleSelectionMode: () => void

  /**
   * Select a single thread (with optional range selection support)
   */
  toggleThread: (
    threadId: string,
    isShiftKey?: boolean,
    allThreadIds?: string[]
  ) => void

  /**
   * Select all threads
   */
  selectAll: (threadIds: string[]) => void

  /**
   * Clear all selections
   */
  clearSelection: () => void

  /**
   * Check if a thread is selected
   */
  isSelected: (threadId: string) => boolean

  /**
   * Get count of selected threads
   */
  getSelectedCount: () => number

  /**
   * Get array of selected thread IDs
   */
  getSelectedThreadIds: () => string[]

  /**
   * Set selection mode explicitly
   */
  setSelectionMode: (isActive: boolean) => void
}

export const useThreadSelection = create<ThreadSelectionState>()(
  (set, get) => ({
    selectedThreadIds: new Set<string>(),
    isSelectionMode: false,
    lastSelectedId: null,

    toggleSelectionMode: () => {
      set((state) => {
        const newMode = !state.isSelectionMode
        // Clear selection when exiting selection mode
        return {
          isSelectionMode: newMode,
          selectedThreadIds: newMode ? state.selectedThreadIds : new Set(),
          lastSelectedId: newMode ? state.lastSelectedId : null,
        }
      })
    },

    setSelectionMode: (isActive: boolean) => {
      set(() => ({
        isSelectionMode: isActive,
        selectedThreadIds: isActive ? get().selectedThreadIds : new Set(),
        lastSelectedId: isActive ? get().lastSelectedId : null,
      }))
    },

    toggleThread: (
      threadId: string,
      isShiftKey = false,
      allThreadIds: string[] = []
    ) => {
      set((state: ThreadSelectionState) => {
        const newSelected = new Set(state.selectedThreadIds)

        // Shift-click range selection
        if (isShiftKey && state.lastSelectedId && allThreadIds.length > 0) {
          const lastIndex = allThreadIds.indexOf(state.lastSelectedId)
          const currentIndex = allThreadIds.indexOf(threadId)

          if (lastIndex !== -1 && currentIndex !== -1) {
            const start = Math.min(lastIndex, currentIndex)
            const end = Math.max(lastIndex, currentIndex)

            for (let i = start; i <= end; i++) {
              newSelected.add(allThreadIds[i])
            }
          } else {
            // Fallback: just toggle the current thread
            if (newSelected.has(threadId)) {
              newSelected.delete(threadId)
            } else {
              newSelected.add(threadId)
            }
          }
        } else {
          // Normal toggle
          if (newSelected.has(threadId)) {
            newSelected.delete(threadId)
          } else {
            newSelected.add(threadId)
          }
        }

        return {
          selectedThreadIds: newSelected,
          lastSelectedId: threadId,
        }
      })
    },

    selectAll: (threadIds: string[]) => {
      set(() => ({
        selectedThreadIds: new Set(threadIds),
      }))
    },

    clearSelection: () => {
      set(() => ({
        selectedThreadIds: new Set(),
        lastSelectedId: null,
      }))
    },

    isSelected: (threadId: string) => {
      return get().selectedThreadIds.has(threadId)
    },

    getSelectedCount: () => {
      return get().selectedThreadIds.size
    },

    getSelectedThreadIds: () => {
      return Array.from(get().selectedThreadIds)
    },
  })
)
