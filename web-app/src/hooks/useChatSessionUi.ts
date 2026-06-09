import { useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'

import { useChatSessionId } from '@/hooks/useChatSessionScope'
import {
  useChatSessionState,
  type ChatSessionUiState,
} from '@/stores/chat-session-state-store'
import { useTerminalRuntime } from '@/stores/terminal-runtime-store'

export function useChatSessionUi(): ChatSessionUiState {
  const sessionId = useChatSessionId()
  return useChatSessionState(
    useShallow((state) => state.getSession(sessionId))
  )
}

export function useChatSessionUiActions() {
  const sessionId = useChatSessionId()
  const patchSession = useChatSessionState((state) => state.patchSession)

  return useMemo(
    () => ({
      patch: (patch: Partial<ChatSessionUiState>) =>
        patchSession(sessionId, patch),
      setSidePanelOpen: (sidePanelOpen: boolean) =>
        patchSession(sessionId, { sidePanelOpen }),
      toggleSidePanelOpen: () =>
        patchSession(sessionId, {
          sidePanelOpen: !useChatSessionState.getState().getSession(sessionId)
            .sidePanelOpen,
        }),
      setSidePanelWidth: (sidePanelWidth: string) =>
        patchSession(sessionId, { sidePanelWidth }),
      setSidePanelActiveSection: (sidePanelActiveSection: string) => {
        const current = useChatSessionState.getState().getSession(sessionId)
        const resolvedSection = normalizePanelSection(
          sidePanelActiveSection,
          current
        )
        const openTabs =
          current.sidePanelOpenTabs ??
          ['files', 'side-chat', 'review', 'terminal', 'browser']
        const nextTabs = addPanelTab(openTabs, sidePanelActiveSection, current)
        patchSession(sessionId, {
          sidePanelActiveSection: resolvedSection,
          sidePanelOpen: true,
          sidePanelOpenTabs: nextTabs,
        })
      },
      closeSidePanelTab: (sectionToClose: string) => {
        const current = useChatSessionState.getState().getSession(sessionId)
        const openTabs = current.sidePanelOpenTabs ?? ['files', 'side-chat', 'review', 'terminal', 'browser']
        const nextTabs = openTabs.filter((tab) => tab !== sectionToClose)
        
        const patch: Partial<ChatSessionUiState> = {
          sidePanelOpenTabs: nextTabs,
        }

        if (sectionToClose.startsWith('terminal:')) {
          const sid = sectionToClose.replace('terminal:', '')
          patch.terminalLinkedSessionIds = current.terminalLinkedSessionIds.filter((id) => id !== sid)
          if (current.terminalActiveSessionId === sid) {
            patch.terminalActiveSessionId = patch.terminalLinkedSessionIds[0] ?? null
          }
        }

        if (current.sidePanelActiveSection === sectionToClose) {
          const resolved = resolveOpenTabs(nextTabs, patch.terminalLinkedSessionIds ?? current.terminalLinkedSessionIds)
          if (resolved.length > 0) {
            patch.sidePanelActiveSection = resolved[resolved.length - 1]
          } else {
            patch.sidePanelOpen = false
          }
        }
        patchSession(sessionId, patch)
      },
      setBottomPanelOpen: (bottomPanelOpen: boolean) =>
        patchSession(sessionId, { bottomPanelOpen }),
      toggleBottomPanelOpen: () =>
        patchSession(sessionId, {
          bottomPanelOpen: !useChatSessionState.getState().getSession(sessionId)
            .bottomPanelOpen,
        }),
      setBottomPanelHeight: (bottomPanelHeight: string) =>
        patchSession(sessionId, { bottomPanelHeight }),
      setBottomPanelActiveSection: (
        bottomPanelActiveSection: string
      ) => {
        const current = useChatSessionState.getState().getSession(sessionId)
        const resolvedSection = normalizePanelSection(
          bottomPanelActiveSection,
          current
        )
        const openTabs = current.bottomPanelOpenTabs ?? ['terminal', 'browser']
        const nextTabs = addPanelTab(openTabs, bottomPanelActiveSection, current)
        patchSession(sessionId, {
          bottomPanelActiveSection: resolvedSection,
          bottomPanelOpen: true,
          bottomPanelOpenTabs: nextTabs,
        })
      },
      closeBottomPanelTab: (sectionToClose: string) => {
        const current = useChatSessionState.getState().getSession(sessionId)
        const openTabs = current.bottomPanelOpenTabs ?? ['terminal', 'browser']
        const nextTabs = openTabs.filter((tab) => tab !== sectionToClose)
        
        const patch: Partial<ChatSessionUiState> = {
          bottomPanelOpenTabs: nextTabs,
        }

        if (sectionToClose.startsWith('terminal:')) {
          const sid = sectionToClose.replace('terminal:', '')
          patch.terminalLinkedSessionIds = current.terminalLinkedSessionIds.filter((id) => id !== sid)
          if (current.terminalActiveSessionId === sid) {
            patch.terminalActiveSessionId = patch.terminalLinkedSessionIds[0] ?? null
          }
        }

        if (current.bottomPanelActiveSection === sectionToClose) {
          const resolved = resolveOpenTabs(nextTabs, patch.terminalLinkedSessionIds ?? current.terminalLinkedSessionIds)
          if (resolved.length > 0) {
            patch.bottomPanelActiveSection = resolved[resolved.length - 1]
          } else {
            patch.bottomPanelOpen = false
          }
        }
        patchSession(sessionId, patch)
      },
      openNewTerminal: async (panel: 'side' | 'bottom') => {
        try {
          const info = await invoke<any>('start_terminal_session', {
            request: { cols: 80, rows: 24 }
          })
          useTerminalRuntime.getState().upsertSession(info)
          
          const current = useChatSessionState.getState().getSession(sessionId)
          const tabId = `terminal:${info.sessionId}`
          
          if (panel === 'side') {
            const openTabs = current.sidePanelOpenTabs ?? ['files', 'side-chat', 'review', 'terminal', 'browser']
            const nextTabs = [...openTabs.filter(t => t !== 'terminal'), tabId]
            patchSession(sessionId, {
              sidePanelActiveSection: tabId,
              sidePanelOpenTabs: nextTabs,
              sidePanelOpen: true,
            })
          } else {
            const openTabs = current.bottomPanelOpenTabs ?? ['terminal', 'browser']
            const nextTabs = [...openTabs.filter(t => t !== 'terminal'), tabId]
            patchSession(sessionId, {
              bottomPanelActiveSection: tabId,
              bottomPanelOpenTabs: nextTabs,
              bottomPanelOpen: true,
            })
          }
          const terminalLinkedSessionIds = Array.from(
            new Set([...current.terminalLinkedSessionIds, info.sessionId])
          )
          patchSession(sessionId, {
            terminalActiveSessionId: info.sessionId,
            terminalLinkedSessionIds,
          })
        } catch (error) {
          console.error('Failed to start terminal:', error)
          toast.error('Failed to start terminal: ' + String(error))
        }
      },
      setBrowserAddressInput: (browserAddressInput: string) =>
        patchSession(sessionId, { browserAddressInput }),
      setBrowserActiveUrl: (browserActiveUrl: string | null) =>
        patchSession(sessionId, { browserActiveUrl }),
      linkTerminalSession: (sessionIdToLink: string) => {
        const current = useChatSessionState.getState().getSession(sessionId)
        const terminalLinkedSessionIds = Array.from(
          new Set([...current.terminalLinkedSessionIds, sessionIdToLink])
        )
        const sessionWithLink: ChatSessionUiState = {
          ...current,
          terminalActiveSessionId: sessionIdToLink,
          terminalLinkedSessionIds,
        }
        const patch: Partial<ChatSessionUiState> = {
          terminalActiveSessionId: sessionIdToLink,
          terminalLinkedSessionIds,
        }

        if (current.sidePanelOpenTabs?.includes('terminal')) {
          patch.sidePanelOpenTabs = normalizePanelTabs(
            current.sidePanelOpenTabs,
            sessionWithLink
          )
        }
        if (current.bottomPanelOpenTabs?.includes('terminal')) {
          patch.bottomPanelOpenTabs = normalizePanelTabs(
            current.bottomPanelOpenTabs,
            sessionWithLink
          )
        }

        patchSession(sessionId, patch)
      },
      setTerminalActiveSessionId: (terminalActiveSessionId: string | null) =>
        patchSession(sessionId, { terminalActiveSessionId }),
      replaceTerminalSession: (deadSessionId: string, newSessionId: string) => {
        const current = useChatSessionState.getState().getSession(sessionId)
        const deadTabId = `terminal:${deadSessionId}`
        const newTabId = `terminal:${newSessionId}`

        const sidePanelOpenTabs = (current.sidePanelOpenTabs ?? []).map((t) =>
          t === deadTabId ? newTabId : t
        )
        const bottomPanelOpenTabs = (current.bottomPanelOpenTabs ?? []).map((t) =>
          t === deadTabId ? newTabId : t
        )
        const terminalLinkedSessionIds = (current.terminalLinkedSessionIds ?? []).map((id) =>
          id === deadSessionId ? newSessionId : id
        )

        const patch: Partial<ChatSessionUiState> = {
          sidePanelOpenTabs,
          bottomPanelOpenTabs,
          terminalLinkedSessionIds,
        }

        if (current.terminalActiveSessionId === deadSessionId) {
          patch.terminalActiveSessionId = newSessionId
        }
        if (current.sidePanelActiveSection === deadTabId) {
          patch.sidePanelActiveSection = newTabId
        }
        if (current.bottomPanelActiveSection === deadTabId) {
          patch.bottomPanelActiveSection = newTabId
        }

        patchSession(sessionId, patch)
      },
    }),
    [patchSession, sessionId]
  )
}

export function useChatSessionUiSelector<T>(
  selector: (session: ChatSessionUiState) => T
): T {
  const sessionId = useChatSessionId()
  const selectorRef = useRef(selector)
  selectorRef.current = selector

  return useChatSessionState(
    useShallow((state) => selectorRef.current(state.getSession(sessionId)))
  )
}

function resolveTerminalTabId(session: ChatSessionUiState): string | null {
  const sid =
    session.terminalActiveSessionId ?? session.terminalLinkedSessionIds[0]
  return sid ? `terminal:${sid}` : null
}

function normalizePanelSection(
  section: string,
  session: ChatSessionUiState
): string {
  if (section !== 'terminal') return section
  return resolveTerminalTabId(session) ?? 'terminal'
}

function dedupeTabs(tabs: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const tab of tabs) {
    if (!seen.has(tab)) {
      seen.add(tab)
      result.push(tab)
    }
  }
  return result
}

function addPanelTab(
  openTabs: string[],
  section: string,
  session: ChatSessionUiState
): string[] {
  const resolved = normalizePanelSection(section, session)
  let next = openTabs.includes(resolved)
    ? [...openTabs]
    : [...openTabs, resolved]
  if (resolved.startsWith('terminal:')) {
    next = next.filter((tab) => tab !== 'terminal')
  }
  return dedupeTabs(next)
}

function normalizePanelTabs(
  openTabs: string[],
  session: ChatSessionUiState
): string[] {
  const tabId = resolveTerminalTabId(session)
  if (!tabId || !openTabs.includes('terminal')) {
    return dedupeTabs(openTabs)
  }

  const next = openTabs.filter((tab) => tab !== 'terminal')
  if (!next.includes(tabId)) {
    next.push(tabId)
  }
  return dedupeTabs(next)
}

export function resolveOpenTabs(
  tabs: string[],
  linkedSessionIds: string[]
): string[] {
  const resolved: string[] = []
  const seen = new Set<string>()

  for (const tab of tabs) {
    if (tab === 'terminal') {
      for (const sid of linkedSessionIds) {
        const id = `terminal:${sid}`
        if (!seen.has(id)) {
          seen.add(id)
          resolved.push(id)
        }
      }
      continue
    }

    if (!seen.has(tab)) {
      seen.add(tab)
      resolved.push(tab)
    }
  }

  return resolved
}