import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AgentType = 'build' | 'plan' | 'explore'

/**
 * Working directory mode for the agent
 */
export type WorkingDirectoryMode =
  | 'custom'    // User-selected project path
  | 'current'   // Current running directory
  | 'workspace' // Jan's data directory

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
  workingDirectoryMode: WorkingDirectoryMode

  // Settings
  autoApproveReadOnly: boolean

  // Actions
  setCurrentAgent: (agent: AgentType) => void
  setProjectPath: (path: string | null) => void
  setWorkingDirectoryMode: (mode: WorkingDirectoryMode) => void
  setAutoApproveReadOnly: (autoApprove: boolean) => void
  clearProjectPath: () => void
}

export const useAgentMode = create<AgentModeState>()(
  persist(
    (set) => ({
      currentAgent: 'build',
      projectPath: null,
      workingDirectoryMode: 'custom',
      autoApproveReadOnly: true,

      setCurrentAgent: (agent) => set({ currentAgent: agent }),

      setProjectPath: (path) => set({
        projectPath: path,
        workingDirectoryMode: path ? 'custom' : 'current',
      }),

      setWorkingDirectoryMode: (mode) => set({ workingDirectoryMode: mode }),

      setAutoApproveReadOnly: (autoApprove) => set({ autoApproveReadOnly: autoApprove }),

      clearProjectPath: () => set({
        projectPath: null,
        workingDirectoryMode: 'current', // Default to current directory
      }),
    }),
    {
      name: 'jan-agent-mode',
      partialize: (state) => ({
        currentAgent: state.currentAgent,
        projectPath: state.projectPath,
        workingDirectoryMode: state.workingDirectoryMode,
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
 * Get the working directory mode
 */
export function useWorkingDirectoryMode() {
  return useAgentMode((state) => state.workingDirectoryMode)
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
    workingDirectoryMode: state.workingDirectoryMode,
    defaultAgent: state.currentAgent,
    autoApproveReadOnly: state.autoApproveReadOnly,
  }))
}

/**
 * Check if agent mode is "enabled" (working directory is configured)
 *
 * Note: In unified mode, this indicates whether OpenCode is available.
 * Without a working directory configured, OpenCode tool is not included.
 * A working directory is considered configured if:
 * - projectPath is set, OR
 * - workingDirectoryMode is 'current' or 'workspace'
 */
export function useIsAgentEnabled() {
  return useAgentMode((state) =>
    state.projectPath !== null || state.workingDirectoryMode !== 'custom'
  )
}