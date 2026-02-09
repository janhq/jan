/**
 * Types for the Jan Orchestrator Agent system
 *
 * This module defines types for the unified agent orchestration flow
 * that combines Vercel AI SDK ToolLoopAgent with OpenCode subprocess delegation.
 */

import type { LanguageModel, Tool } from 'ai'

// ============================================================================
// Agent Configuration Types
// ============================================================================

/**
 * Agent types available for OpenCode delegation
 */
export type OpenCodeAgentType = 'build' | 'plan' | 'explore'

/**
 * Orchestrator mode - determines how messages are processed
 */
export type OrchestratorMode = 'chat' | 'orchestrator'

/**
 * Configuration for the Jan Orchestrator Agent (UI-provided portion)
 * Note: The model is set by the transport layer, not from UI
 */
export interface OrchestratorConfig {
  /** Project path for coding tasks */
  projectPath: string

  /** Agent type for OpenCode delegation (build/plan/explore) */
  agent?: OpenCodeAgentType

  /** Maximum number of steps before stopping (default: 20) */
  maxSteps?: number

  /** Auto-approve read-only operations */
  autoApproveReadOnly?: boolean

  /** Language model - set by transport layer, not from UI */
  model?: LanguageModel
}

// ============================================================================
// Event Types (Unified across AI SDK and agent subprocess)
// ============================================================================

/**
 * Source of an agent event
 */
export type EventSource = 'ai-sdk' | 'opencode'

/**
 * Unified event types for the progress panel
 */
export type UnifiedEventType =
  | 'tool.started'
  | 'tool.completed'
  | 'tool.error'
  | 'tool.approval_requested'
  | 'tool.approval_responded'
  | 'text.delta'
  | 'text.complete'
  | 'file.changed'
  | 'step.started'
  | 'step.completed'
  | 'delegation.started'
  | 'delegation.completed'
  | 'delegation.error'
  | 'session.started'
  | 'reasoning.delta'

/**
 * Base unified event structure
 */
export interface UnifiedAgentEvent {
  id: string
  source: EventSource
  timestamp: number
  type: UnifiedEventType
  data: UnifiedEventData
}

/**
 * Union of all possible event data types
 */
export type UnifiedEventData =
  | ToolStartedData
  | ToolCompletedData
  | ToolErrorData
  | ToolApprovalRequestedData
  | ToolApprovalRespondedData
  | TextDeltaData
  | TextCompleteData
  | FileChangedData
  | StepData
  | DelegationStartedData
  | DelegationCompletedData
  | DelegationErrorData
  | SessionStartedData
  | ReasoningDeltaData

export interface ToolStartedData {
  tool: string
  input: Record<string, unknown>
}

export interface ToolCompletedData {
  tool: string
  output: unknown
  duration?: number
  title?: string
}

export interface ToolErrorData {
  tool: string
  error: string
}

export interface ToolApprovalRequestedData {
  toolCallId: string
  tool: string
  input: Record<string, unknown>
  description?: string
}

export interface ToolApprovalRespondedData {
  toolCallId: string
  tool: string
  approved: boolean
  message?: string
}

export interface TextDeltaData {
  text: string
}

export interface TextCompleteData {
  text: string
}

export interface FileChangedData {
  path: string
  diff?: string
  action: 'created' | 'modified' | 'deleted'
}

export interface StepData {
  step: number
  agent?: string
}

export interface DelegationStartedData {
  taskId: string
  task: string
  agent: OpenCodeAgentType
  projectPath: string
  sessionId?: string
}

export interface DelegationCompletedData {
  taskId: string
  success: boolean
  summary?: string
  filesChanged?: string[]
  tokensUsed?: number
}

export interface DelegationErrorData {
  taskId: string
  error: string
}

export interface SessionStartedData {
  sessionId: string
}

export interface ReasoningDeltaData {
  text: string
}

// ============================================================================
// Orchestrator State Types
// ============================================================================

/**
 * Status of the orchestrator
 */
export type OrchestratorStatus =
  | 'idle'
  | 'thinking'
  | 'executing_tool'
  | 'delegating'
  | 'waiting_approval'
  | 'completed'
  | 'error'

/**
 * Active delegation info
 */
export interface ActiveDelegation {
  taskId: string
  task: string
  agent: OpenCodeAgentType
  projectPath: string
  sessionId?: string
  startedAt: number
}

/**
 * Pending approval request
 */
export interface PendingApproval {
  source: EventSource
  type: 'tool' | 'delegation'
  request: {
    id: string
    name: string
    input?: Record<string, unknown>
    description?: string
    patterns?: string[]
  }
}

/**
 * Orchestrator state for Zustand store
 */
export interface OrchestratorState {
  // Mode configuration
  mode: OrchestratorMode
  config: OrchestratorConfig | null

  // Current status
  status: OrchestratorStatus

  // Active delegation info (when delegating to subprocess)
  activeDelegation: ActiveDelegation | null

  // Unified event stream
  events: UnifiedAgentEvent[]

  // Pending approval request
  pendingApproval: PendingApproval | null

  // Whether the agent panel has been revealed (stays true until manually toggled off)
  panelRevealed: boolean

  // Actions
  setMode: (mode: OrchestratorMode) => void
  setConfig: (config: OrchestratorConfig | null) => void
  setStatus: (status: OrchestratorStatus) => void
  addEvent: (event: UnifiedAgentEvent) => void
  setActiveDelegation: (delegation: ActiveDelegation | null) => void
  setPendingApproval: (approval: PendingApproval | null) => void
  setPanelRevealed: (revealed: boolean) => void
  clearEvents: () => void
  reset: () => void
}

// ============================================================================
// Agent Delegate Tool Types
// ============================================================================

/**
 * Input for the agent_delegate tool
 */
export interface AgentDelegateInput {
  task: string
  projectPath: string
  agent?: OpenCodeAgentType
}

/**
 * Result from OpenCode delegation
 */
export interface OpenCodeDelegateResult {
  success: boolean
  status: 'completed' | 'cancelled' | 'error'
  summary?: string
  filesChanged: string[]
  tokensUsed?: number
  events: UnifiedAgentEvent[]
  error?: string
}

// ============================================================================
// Tool Definition Types
// ============================================================================

/**
 * Extended tool definition with approval support
 */
export type JanTool = Tool & {
  /** Whether this tool requires human approval before execution */
  needsApproval?: boolean | ((input: Record<string, unknown>) => boolean | Promise<boolean>)
}

/**
 * Tools record with Jan extensions
 */
export type JanToolsRecord = Record<string, JanTool>

// ============================================================================
// Callbacks and Event Handlers
// ============================================================================

/**
 * Callback for orchestrator events
 */
export type OnOrchestratorEvent = (event: UnifiedAgentEvent) => void

/**
 * Callback for approval requests
 */
export type OnApprovalRequest = (
  request: PendingApproval
) => Promise<{
  approved: boolean
  message?: string
}>

/**
 * Callback for delegation events (progress updates)
 */
export type OnDelegationProgress = (event: UnifiedAgentEvent) => void
