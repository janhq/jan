/**
 * Orchestrator State Hook
 *
 * Zustand store for managing the orchestrator agent state.
 * Tracks unified events from both AI SDK and OpenCode sources.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  OrchestratorState,
  OrchestratorMode,
  OrchestratorStatus,
  OrchestratorConfig,
  ActiveDelegation,
  PendingApproval,
  UnifiedAgentEvent,
} from '@/lib/agents/types'

// ============================================================================
// Store Implementation
// ============================================================================

const initialState = {
  mode: 'chat' as OrchestratorMode,
  config: null as OrchestratorConfig | null,
  status: 'idle' as OrchestratorStatus,
  activeDelegation: null as ActiveDelegation | null,
  events: [] as UnifiedAgentEvent[],
  pendingApproval: null as PendingApproval | null,
  panelRevealed: false,
}

export const useOrchestratorState = create<OrchestratorState>()(
  persist(
    (set) => ({
      ...initialState,

      setMode: (mode: OrchestratorMode) => set({ mode }),

      setConfig: (config: OrchestratorConfig | null) => set({ config }),

      setStatus: (status: OrchestratorStatus) => set({ status }),

      addEvent: (event: UnifiedAgentEvent) =>
        set((state) => ({
          events: [...state.events, event],
        })),

      setActiveDelegation: (delegation: ActiveDelegation | null) =>
        set({ activeDelegation: delegation }),

      setPendingApproval: (approval: PendingApproval | null) =>
        set({ pendingApproval: approval }),

      setPanelRevealed: (revealed: boolean) => set({ panelRevealed: revealed }),

      clearEvents: () => set({ events: [] }),

      reset: () =>
        set({
          status: 'idle',
          activeDelegation: null,
          events: [],
          pendingApproval: null,
        }),
    }),
    {
      name: 'jan-orchestrator-state',
      // Only persist mode and config, not runtime state
      partialize: (state) => ({
        mode: state.mode,
        // Don't persist config as it contains non-serializable LanguageModel
      }),
    }
  )
)

// ============================================================================
// Selector Hooks
// ============================================================================

/**
 * Get the current orchestrator mode
 */
export function useOrchestratorMode() {
  return useOrchestratorState((state) => state.mode)
}

/**
 * Check if orchestrator mode is enabled
 */
export function useIsOrchestratorMode() {
  return useOrchestratorState((state) => state.mode === 'orchestrator')
}

/**
 * Get the current orchestrator status
 */
export function useOrchestratorStatus() {
  return useOrchestratorState((state) => state.status)
}

/**
 * Get all orchestrator events
 */
export function useOrchestratorEvents() {
  return useOrchestratorState((state) => state.events)
}

/**
 * Get events filtered by source
 */
export function useOrchestratorEventsBySource(source: 'ai-sdk' | 'opencode') {
  return useOrchestratorState((state) =>
    state.events.filter((e) => e.source === source)
  )
}

/**
 * Get the active delegation if any
 */
export function useActiveDelegation() {
  return useOrchestratorState((state) => state.activeDelegation)
}

/**
 * Check if there's an active delegation
 */
export function useHasActiveDelegation() {
  return useOrchestratorState((state) => state.activeDelegation !== null)
}

/**
 * Get the pending approval request if any
 */
export function usePendingApproval() {
  return useOrchestratorState((state) => state.pendingApproval)
}

/**
 * Check if there's a pending approval
 */
export function useHasPendingApproval() {
  return useOrchestratorState((state) => state.pendingApproval !== null)
}

/**
 * Get recent events (last N events)
 */
export function useRecentEvents(count: number = 10) {
  return useOrchestratorState((state) => state.events.slice(-count))
}

/**
 * Get tool events only
 */
export function useToolEvents() {
  return useOrchestratorState((state) =>
    state.events.filter(
      (e) =>
        e.type === 'tool.started' ||
        e.type === 'tool.completed' ||
        e.type === 'tool.error'
    )
  )
}

/**
 * Get delegation events only
 */
export function useDelegationEvents() {
  return useOrchestratorState((state) =>
    state.events.filter(
      (e) =>
        e.type === 'delegation.started' ||
        e.type === 'delegation.completed' ||
        e.type === 'delegation.error'
    )
  )
}

/**
 * Get file change events
 */
export function useFileChangeEvents() {
  return useOrchestratorState((state) =>
    state.events.filter((e) => e.type === 'file.changed')
  )
}

// ============================================================================
// Action Hooks
// ============================================================================

/**
 * Get orchestrator actions without subscribing to state changes
 */
export function useOrchestratorActions() {
  return {
    setMode: useOrchestratorState.getState().setMode,
    setConfig: useOrchestratorState.getState().setConfig,
    setStatus: useOrchestratorState.getState().setStatus,
    addEvent: useOrchestratorState.getState().addEvent,
    setActiveDelegation: useOrchestratorState.getState().setActiveDelegation,
    setPendingApproval: useOrchestratorState.getState().setPendingApproval,
    setPanelRevealed: useOrchestratorState.getState().setPanelRevealed,
    clearEvents: useOrchestratorState.getState().clearEvents,
    reset: useOrchestratorState.getState().reset,
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get status display info
 */
export function getStatusInfo(status: OrchestratorStatus): {
  label: string
  color: string
  icon: string
} {
  switch (status) {
    case 'idle':
      return { label: 'Ready', color: 'text-muted-foreground', icon: 'circle' }
    case 'thinking':
      return { label: 'Thinking...', color: 'text-blue-500', icon: 'brain' }
    case 'executing_tool':
      return { label: 'Executing tool...', color: 'text-yellow-500', icon: 'tool' }
    case 'delegating':
      return { label: 'Delegating to OpenCode...', color: 'text-purple-500', icon: 'code' }
    case 'waiting_approval':
      return { label: 'Waiting for approval', color: 'text-orange-500', icon: 'shield' }
    case 'completed':
      return { label: 'Completed', color: 'text-green-500', icon: 'check' }
    case 'error':
      return { label: 'Error', color: 'text-red-500', icon: 'x' }
    default:
      return { label: 'Unknown', color: 'text-muted-foreground', icon: 'question' }
  }
}

/**
 * Format event for display
 */
export function formatEventForDisplay(event: UnifiedAgentEvent): string {
  switch (event.type) {
    case 'tool.started':
      return `Starting tool: ${(event.data as { tool: string }).tool}`
    case 'tool.completed':
      return `Completed tool: ${(event.data as { tool: string }).tool}`
    case 'tool.error':
      return `Tool error: ${(event.data as { error: string }).error}`
    case 'delegation.started':
      return `Delegating to OpenCode: ${(event.data as { task: string }).task.slice(0, 50)}...`
    case 'delegation.completed':
      return `OpenCode completed: ${(event.data as { filesChanged?: string[] }).filesChanged?.length ?? 0} files changed`
    case 'delegation.error':
      return `OpenCode error: ${(event.data as { error: string }).error}`
    case 'file.changed':
      return `File changed: ${(event.data as { path: string }).path}`
    case 'step.started':
      return `Step ${(event.data as { step: number }).step} started`
    case 'step.completed':
      return `Step ${(event.data as { step: number }).step} completed`
    default:
      return event.type
  }
}
