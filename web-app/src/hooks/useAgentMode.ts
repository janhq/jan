import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AgentType = 'build' | 'plan' | 'explore'

/**
 * Simplified agent state for unified mode.
 *
 * The AI SDK ToolLoopAgent automatically decides when to use tools.
 * Only project path needs to be configured for OpenCode.
 */
interface AgentModeState {
  // State
  currentAgent: AgentType
  projectPath: string | null

  // Settings
  autoApproveReadOnly: boolean

  // Actions
  setCurrentAgent: (agent: AgentType) => void
  setProjectPath: (path: string | null) => void
  setAutoApproveReadOnly: (autoApprove: boolean) => void
}

export const useAgentMode = create<AgentModeState>()(
  persist(
    (set) => ({
      currentAgent: 'build',
      projectPath: null,
      autoApproveReadOnly: true,

      setCurrentAgent: (agent) => set({ currentAgent: agent }),

      setProjectPath: (path) => set({ projectPath: path }),

      setAutoApproveReadOnly: (autoApprove) => set({ autoApproveReadOnly: autoApprove }),
    }),
    {
      name: 'jan-agent-mode',
      partialize: (state) => ({
        currentAgent: state.currentAgent,
        projectPath: state.projectPath,
        autoApproveReadOnly: state.autoApproveReadOnly,
      }),
    }
  )
)

// ============================================================================
// Selector Hooks
// ============================================================================

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
 * Get auto-approve read-only setting
 */
export function useAutoApproveReadOnly() {
  return useAgentMode((state) => state.autoApproveReadOnly)
}

/**
 * Get full agent configuration
 */
export function useAgentConfig() {
  return useAgentMode((state) => ({
    projectPath: state.projectPath,
    defaultAgent: state.currentAgent,
    autoApproveReadOnly: state.autoApproveReadOnly,
  }))
}

/**
 * Check if agent mode is "enabled" (project path is set)
 *
 * Note: In unified mode, this indicates whether OpenCode is available.
 * Without a project path, OpenCode tool is not included.
 */
export function useIsAgentEnabled() {
  return useAgentMode((state) => state.projectPath !== null)
}