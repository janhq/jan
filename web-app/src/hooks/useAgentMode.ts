import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useOrchestratorState } from './useOrchestratorState'

export type AgentType = 'build' | 'plan' | 'explore'

/**
 * Agent execution mode:
 * - 'manual': User explicitly triggers OpenCode for coding tasks
 * - 'orchestrator': AI SDK ToolLoopAgent auto-detects and delegates to OpenCode
 */
export type AgentExecutionMode = 'manual' | 'orchestrator'

interface AgentModeState {
  // State
  isAgentMode: boolean
  currentAgent: AgentType
  projectPath: string | null

  // Orchestrator settings
  executionMode: AgentExecutionMode
  orchestratorMaxSteps: number
  autoApproveReadOnly: boolean

  // Actions
  setAgentMode: (enabled: boolean) => void
  toggleAgentMode: () => void
  setCurrentAgent: (agent: AgentType) => void
  setProjectPath: (path: string | null) => void

  // Orchestrator actions
  setExecutionMode: (mode: AgentExecutionMode) => void
  setOrchestratorMaxSteps: (steps: number) => void
  setAutoApproveReadOnly: (autoApprove: boolean) => void
}

export const useAgentMode = create<AgentModeState>()(
  persist(
    (set) => ({
      isAgentMode: false,
      currentAgent: 'build',
      projectPath: null,

      // Orchestrator defaults
      executionMode: 'manual',
      orchestratorMaxSteps: 20,
      autoApproveReadOnly: true,

      setAgentMode: (enabled) => set({ isAgentMode: enabled }),

      toggleAgentMode: () => set((state) => ({ isAgentMode: !state.isAgentMode })),

      setCurrentAgent: (agent) => set({ currentAgent: agent }),

      setProjectPath: (path) => set({ projectPath: path }),

      // Orchestrator actions - sync with useOrchestratorState
      setExecutionMode: (mode) => {
        set({ executionMode: mode })
        // Sync with orchestrator state store
        if (mode === 'orchestrator') {
          useOrchestratorState.getState().setMode('orchestrator')
        } else {
          useOrchestratorState.getState().setMode('chat')
        }
      },

      setOrchestratorMaxSteps: (steps) => set({ orchestratorMaxSteps: steps }),

      setAutoApproveReadOnly: (autoApprove) => set({ autoApproveReadOnly: autoApprove }),
    }),
    {
      name: 'jan-agent-mode',
      partialize: (state) => ({
        isAgentMode: state.isAgentMode,
        currentAgent: state.currentAgent,
        projectPath: state.projectPath,
        executionMode: state.executionMode,
        orchestratorMaxSteps: state.orchestratorMaxSteps,
        autoApproveReadOnly: state.autoApproveReadOnly,
      }),
      onRehydrateStorage: () => (setState, error, state) => {
        // Sync orchestrator state after rehydration
        if (state && state.executionMode === 'orchestrator') {
          useOrchestratorState.getState().setMode('orchestrator')
        }
      },
    }
  )
)

// ============================================================================
// Selector Hooks
// ============================================================================

/**
 * Check if agent mode is enabled
 */
export function useIsAgentMode() {
  return useAgentMode((state) => state.isAgentMode)
}

/**
 * Get the current agent type
 */
export function useCurrentAgent() {
  return useAgentMode((state) => state.currentAgent)
}

/**
 * Get the current project path
 */
export function useProjectPath() {
  return useAgentMode((state) => state.projectPath)
}

/**
 * Get the current execution mode
 */
export function useExecutionMode() {
  return useAgentMode((state) => state.executionMode)
}

/**
 * Check if orchestrator mode is enabled
 */
export function useIsOrchestratorMode() {
  return useAgentMode((state) => state.isAgentMode && state.executionMode === 'orchestrator')
}

/**
 * Check if manual agent mode is enabled
 */
export function useIsManualAgentMode() {
  return useAgentMode((state) => state.isAgentMode && state.executionMode === 'manual')
}

/**
 * Get orchestrator max steps setting
 */
export function useOrchestratorMaxSteps() {
  return useAgentMode((state) => state.orchestratorMaxSteps)
}

/**
 * Get auto-approve read-only setting
 */
export function useAutoApproveReadOnly() {
  return useAgentMode((state) => state.autoApproveReadOnly)
}

/**
 * Get full orchestrator configuration
 */
export function useOrchestratorConfig() {
  return useAgentMode((state) => ({
    isEnabled: state.isAgentMode && state.executionMode === 'orchestrator',
    maxSteps: state.orchestratorMaxSteps,
    autoApproveReadOnly: state.autoApproveReadOnly,
    projectPath: state.projectPath,
    defaultAgent: state.currentAgent,
  }))
}
