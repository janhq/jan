import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import {
  CHAT_SIDE_PANEL_DEFAULT_WIDTH,
  type ChatSidePanelSection,
} from '@/constants/chat-side-panel'
import { localStorageKey } from '@/constants/localStorage'

export type ChatSidePanelTab = {
  id: string
  type: ChatSidePanelSection
}

type ChatSidePanelState = {
  open: boolean
  width: string
  tabs: ChatSidePanelTab[]
  activeTabId: string | null
  toggleOpen: () => void
  setOpen: (open: boolean) => void
  setWidth: (width: string) => void
  openTab: (type: ChatSidePanelSection) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
}

const createTabId = () =>
  `panel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const createDefaultTabs = () => {
  const tab: ChatSidePanelTab = { id: createTabId(), type: 'files' }
  return { tabs: [tab], activeTabId: tab.id }
}

const initialPanel = createDefaultTabs()

const panelStorage = createJSONStorage<
  Pick<ChatSidePanelState, 'open' | 'width' | 'tabs' | 'activeTabId'>
>(() => localStorage)

export const useChatSidePanel = create<ChatSidePanelState>()(
  persist(
    (set, get) => ({
      open: true,
      width: CHAT_SIDE_PANEL_DEFAULT_WIDTH,
      tabs: initialPanel.tabs,
      activeTabId: initialPanel.activeTabId,

      toggleOpen: () => {
        set((state) => ({ open: !state.open }))
      },

      setOpen: (open) => set({ open }),

      setWidth: (width) => set({ width }),

      openTab: (type) => {
        const { tabs } = get()
        const existing = tabs.find((tab) => tab.type === type)

        if (existing) {
          set({ open: true, activeTabId: existing.id })
          return
        }

        const tab: ChatSidePanelTab = { id: createTabId(), type }
        set((state) => ({
          open: true,
          tabs: [...state.tabs, tab],
          activeTabId: tab.id,
        }))
      },

      closeTab: (tabId) => {
        set((state) => {
          const nextTabs = state.tabs.filter((tab) => tab.id !== tabId)
          if (nextTabs.length === 0) {
            return {
              tabs: [],
              activeTabId: null,
              open: false,
            }
          }

          const nextActive =
            state.activeTabId === tabId
              ? (nextTabs[nextTabs.length - 1]?.id ?? null)
              : state.activeTabId

          return {
            tabs: nextTabs,
            activeTabId: nextActive,
          }
        })
      },

      setActiveTab: (tabId) => set({ activeTabId: tabId }),
    }),
    {
      name: localStorageKey.chatSidePanel,
      storage: panelStorage,
      partialize: (state) => ({
        open: state.open,
        width: state.width,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return

        state.tabs = state.tabs.map((tab) =>
          (tab.type as string) === 'model' || (tab.type as string) === 'context'
            ? { ...tab, type: 'files' }
            : tab
        )

        if (state.tabs.length === 0) {
          const defaults = createDefaultTabs()
          state.tabs = defaults.tabs
          state.activeTabId = defaults.activeTabId
        } else if (
          !state.activeTabId ||
          !state.tabs.some((tab) => tab.id === state.activeTabId)
        ) {
          state.activeTabId = state.tabs[0]?.id ?? null
        }
      },
    }
  )
)
