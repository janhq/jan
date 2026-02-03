/**
 * Agent Transport
 *
 * Extends the CustomChatTransport to support orchestrator mode.
 * When orchestrator mode is enabled, messages are processed through
 * the ToolLoopAgent instead of direct streamText calls.
 */

import type { UIMessage } from '@ai-sdk/react'
import {
  convertToModelMessages,
  streamText,
  type ChatRequestOptions,
  type ChatTransport,
  type LanguageModel,
  type UIMessageChunk,
  type Tool,
  type LanguageModelUsage,
  jsonSchema,
} from 'ai'
import { useServiceStore } from '@/hooks/useServiceHub'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { ModelFactory } from '../model-factory'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useOrchestratorState } from '@/hooks/useOrchestratorState'
import { createOpenCodeDelegateTool } from '@/tools/opencode-delegate'
import type {
  OrchestratorConfig,
  UnifiedAgentEvent,
} from './types'

// ============================================================================
// Types
// ============================================================================

export type TokenUsageCallback = (
  usage: LanguageModelUsage,
  messageId: string
) => void

export type StreamingTokenSpeedCallback = (
  tokenCount: number,
  elapsedMs: number
) => void

export type OnFinishCallback = (params: {
  message: UIMessage
  isAbort?: boolean
}) => void

export type OnToolCallCallback = (params: {
  toolCall: { toolCallId: string; toolName: string; input: unknown }
}) => void

export type ServiceHub = {
  rag(): {
    getTools(): Promise<
      Array<{ name: string; description: string; inputSchema: unknown }>
    >
  }
  mcp(): {
    getTools(): Promise<
      Array<{ name: string; description: string; inputSchema: unknown }>
    >
  }
}

// ============================================================================
// Agent Transport Class
// ============================================================================

/**
 * AgentChatTransport - Extends chat transport with orchestrator support
 *
 * This transport can operate in two modes:
 * 1. Chat mode: Uses streamText directly (existing behavior)
 * 2. Orchestrator mode: Uses ToolLoopAgent with OpenCode delegation
 */
export class AgentChatTransport implements ChatTransport<UIMessage> {
  public model: LanguageModel | null = null
  private tools: Record<string, Tool> = {}
  private onTokenUsage?: TokenUsageCallback
  private onStreamingTokenSpeed?: StreamingTokenSpeedCallback
  private hasDocuments = false
  private modelSupportsTools = false
  private ragFeatureAvailable = false
  private systemMessage?: string
  private threadId?: string

  // Orchestrator-specific fields
  private orchestratorConfig: OrchestratorConfig | null = null

  constructor(systemMessage?: string, threadId?: string) {
    this.systemMessage = systemMessage
    this.threadId = threadId
  }

  // ============================================================================
  // Service Hub Accessor (lazy)
  // ============================================================================

  private getServiceHub(): ServiceHub | null {
    return useServiceStore.getState().serviceHub ?? null
  }

  // ============================================================================
  // Configuration Methods
  // ============================================================================

  updateSystemMessage(systemMessage: string | undefined) {
    this.systemMessage = systemMessage
  }

  setOnStreamingTokenSpeed(callback: StreamingTokenSpeedCallback | undefined) {
    this.onStreamingTokenSpeed = callback
  }

  setOnTokenUsage(callback: TokenUsageCallback | undefined) {
    this.onTokenUsage = callback
  }

  /**
   * Configure orchestrator mode
   */
  setOrchestratorConfig(config: OrchestratorConfig | null) {
    this.orchestratorConfig = config
  }

  /**
   * Check if orchestrator mode is enabled
   */
  isOrchestratorMode(): boolean {
    return this.orchestratorConfig !== null
  }

  // ============================================================================
  // Tool Management
  // ============================================================================

  async updateRagToolsAvailability(
    hasDocuments: boolean,
    modelSupportsTools: boolean,
    ragFeatureAvailable: boolean
  ) {
    this.hasDocuments = hasDocuments
    this.modelSupportsTools = modelSupportsTools
    this.ragFeatureAvailable = ragFeatureAvailable
    await this.refreshTools()
  }

  async refreshTools() {
    const serviceHub = this.getServiceHub()
    if (!serviceHub) {
      this.tools = {}
      return
    }

    const toolsRecord: Record<string, Tool> = {}

    const getDisabledToolsForThread =
      useToolAvailable.getState().getDisabledToolsForThread
    const disabledToolKeys = this.threadId
      ? getDisabledToolsForThread(this.threadId)
      : []

    const isToolDisabled = (serverName: string, toolName: string): boolean => {
      const toolKey = `${serverName}::${toolName}`
      return disabledToolKeys.includes(toolKey)
    }

    if (this.modelSupportsTools) {
      // Load RAG tools
      if (this.hasDocuments && this.ragFeatureAvailable) {
        try {
          const ragTools = await serviceHub.rag().getTools()
          if (Array.isArray(ragTools) && ragTools.length > 0) {
            ragTools.forEach((tool) => {
              const serverName =
                (tool as { server?: string }).server || 'unknown'
              if (!isToolDisabled(serverName, tool.name)) {
                toolsRecord[tool.name] = {
                  description: tool.description,
                  inputSchema: jsonSchema(
                    tool.inputSchema as Record<string, unknown>
                  ),
                } as Tool
              }
            })
          }
        } catch (error) {
          console.warn('Failed to load RAG tools:', error)
        }
      }

      // Load MCP tools
      try {
        const mcpTools = await serviceHub.mcp().getTools()
        if (Array.isArray(mcpTools) && mcpTools.length > 0) {
          mcpTools.forEach((tool) => {
            const serverName = (tool as { server?: string }).server || 'unknown'
            if (!isToolDisabled(serverName, tool.name)) {
              toolsRecord[tool.name] = {
                description: tool.description,
                inputSchema: jsonSchema(
                  tool.inputSchema as Record<string, unknown>
                ),
              } as Tool
            }
          })
        }
      } catch (error) {
        console.warn('Failed to load MCP tools:', error)
      }
    }

    this.tools = toolsRecord
  }

  getTools(): Record<string, Tool> {
    return this.tools
  }

  // ============================================================================
  // Message Sending
  // ============================================================================

  async sendMessages(
    options: {
      chatId: string
      messages: UIMessage[]
      abortSignal: AbortSignal | undefined
    } & {
      trigger: 'submit-message' | 'regenerate-message'
      messageId: string | undefined
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk>> {
    await this.refreshTools()

    // Debug: log available tools
    console.log('[AgentTransport] Available tools:', Object.keys(this.tools))
    console.log('[AgentTransport] Model supports tools:', this.modelSupportsTools)

    // Initialize model
    const modelId = useModelProvider.getState().selectedModel?.id
    const providerId = useModelProvider.getState().selectedProvider
    const provider = useModelProvider.getState().getProviderByName(providerId)
    const serviceHub = this.getServiceHub()

    if (serviceHub && modelId && provider) {
      try {
        const updatedProvider = useModelProvider
          .getState()
          .getProviderByName(providerId)

        this.model = await ModelFactory.createModel(
          modelId,
          updatedProvider ?? provider
        )
      } catch (error) {
        console.error('Failed to create model:', error)
        throw new Error(
          `Failed to create model: ${error instanceof Error ? error.message : JSON.stringify(error)}`
        )
      }
    } else {
      throw new Error('ServiceHub not initialized or model/provider missing.')
    }

    // If orchestrator mode is enabled, use the orchestrator
    if (this.orchestratorConfig && this.model) {
      return this.sendMessagesWithOrchestrator(options)
    }

    // Otherwise, use standard streamText
    return this.sendMessagesWithStreamText(options)
  }

  // ============================================================================
  // Standard Stream Text Mode
  // ============================================================================

  private async sendMessagesWithStreamText(
    options: {
      chatId: string
      messages: UIMessage[]
      abortSignal: AbortSignal | undefined
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk>> {
    // Note: In AI SDK 6, convertToModelMessages is async
    const modelMessages = await convertToModelMessages(
      this.mapUserInlineAttachments(options.messages)
    )

    const hasTools = Object.keys(this.tools).length > 0
    const shouldEnableTools = hasTools && this.modelSupportsTools

    let streamStartTime: number | undefined
    let textDeltaCount = 0

    const result = streamText({
      model: this.model!,
      messages: modelMessages,
      abortSignal: options.abortSignal,
      tools: shouldEnableTools ? this.tools : undefined,
      toolChoice: shouldEnableTools ? 'auto' : undefined,
      system: this.systemMessage,
    })

    return result.toUIMessageStream({
      messageMetadata: ({ part }) => {
        if (!streamStartTime) {
          streamStartTime = Date.now()
        }

        if (part.type === 'text-delta') {
          textDeltaCount++
          if (this.onStreamingTokenSpeed) {
            const elapsedMs = Date.now() - streamStartTime
            this.onStreamingTokenSpeed(textDeltaCount, elapsedMs)
          }
        }

        if (part.type === 'finish') {
          const finishPart = part as {
            type: 'finish'
            totalUsage: LanguageModelUsage
            finishReason: string
            providerMetadata?: {
              llamacpp?: {
                promptTokens?: number | null
                completionTokens?: number | null
                tokensPerSecond?: number | null
              }
            }
          }
          const usage = finishPart.totalUsage
          const llamacppMeta = finishPart.providerMetadata?.llamacpp
          const durationMs = streamStartTime ? Date.now() - streamStartTime : 0
          const durationSec = durationMs / 1000

          const outputTokens =
            usage?.outputTokens ??
            llamacppMeta?.completionTokens ??
            textDeltaCount
          const inputTokens = usage?.inputTokens ?? llamacppMeta?.promptTokens

          let tokenSpeed: number
          if (llamacppMeta?.tokensPerSecond != null) {
            tokenSpeed = llamacppMeta.tokensPerSecond
          } else if (durationSec > 0 && outputTokens > 0) {
            tokenSpeed = outputTokens / durationSec
          } else {
            tokenSpeed = 0
          }

          return {
            usage: {
              inputTokens: inputTokens,
              outputTokens: outputTokens,
              totalTokens: usage?.totalTokens ?? (inputTokens ?? 0) + outputTokens,
            },
            tokenSpeed: {
              tokenSpeed: Math.round(tokenSpeed * 10) / 10,
              tokenCount: outputTokens,
              durationMs,
            },
          }
        }

        return undefined
      },
      onError: (error) => {
        if (error == null) return 'Unknown error'
        if (typeof error === 'string') return error
        if (error instanceof Error) return error.message
        return JSON.stringify(error)
      },
      onFinish: ({ responseMessage }) => {
        if (responseMessage) {
          const metadata = responseMessage.metadata as
            | Record<string, unknown>
            | undefined
          const usage = metadata?.usage as LanguageModelUsage | undefined
          if (usage) {
            this.onTokenUsage?.(usage, responseMessage.id)
          }
        }
      },
    })
  }

  // ============================================================================
  // Orchestrator Mode
  // ============================================================================

  private async sendMessagesWithOrchestrator(
    options: {
      chatId: string
      messages: UIMessage[]
      abortSignal: AbortSignal | undefined
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk>> {
    if (!this.orchestratorConfig || !this.model) {
      throw new Error('Orchestrator not configured')
    }

    // Update orchestrator state to thinking
    const { setStatus, addEvent, clearEvents, setPendingApproval } = useOrchestratorState.getState()

    // Clear previous events for new task
    clearEvents()
    setStatus('thinking')

    // Add step started event
    addEvent({
      id: `step-start-${Date.now()}`,
      source: 'ai-sdk',
      timestamp: Date.now(),
      type: 'step.started',
      data: { step: 1 },
    })

    // Note: In AI SDK 6, convertToModelMessages is async
    const modelMessages = await convertToModelMessages(
      this.mapUserInlineAttachments(options.messages)
    )

    // Create the OpenCode delegate tool with context
    const opencodeTool = createOpenCodeDelegateTool({
      projectPath: this.orchestratorConfig.projectPath,
      agent: this.orchestratorConfig.agent || 'build',
      autoApproveReadOnly: this.orchestratorConfig.autoApproveReadOnly,
      onProgress: (event: UnifiedAgentEvent) => {
        addEvent(event)
      },
      onPermissionRequest: async (request) => {
        // Set up pending approval in state for UI
        setPendingApproval({
          source: 'opencode',
          type: 'tool',
          request: {
            id: request.permissionId,
            name: request.permission,
            input: request.metadata,
            description: request.description,
          },
        })
        setStatus('waiting_approval')

        // Wait for user response via the state
        // This is a simplified approach - in production, you'd use a promise resolver
        return new Promise((resolve) => {
          const checkApproval = setInterval(() => {
            const state = useOrchestratorState.getState()
            if (!state.pendingApproval) {
              clearInterval(checkApproval)
              // Check the last approval response event
              const lastApprovalEvent = [...state.events].reverse().find(
                (e) => e.type === 'tool.approval_responded' &&
                       (e.data as { toolCallId: string }).toolCallId === request.permissionId
              )
              if (lastApprovalEvent) {
                const data = lastApprovalEvent.data as { approved: boolean; message?: string }
                resolve({
                  action: data.approved ? 'allow_once' : 'deny',
                  message: data.message,
                })
              } else {
                resolve({ action: 'deny' })
              }
            }
          }, 100)
        })
      },
    })

    // Combine all tools: existing tools + OpenCode delegate
    const allTools: Record<string, Tool> = {
      ...this.tools,
      opencode_delegate: opencodeTool,
    }

    // System prompt for orchestrator mode
    const orchestratorSystemPrompt = this.systemMessage
      ? `${this.systemMessage}\n\nYou have access to the opencode_delegate tool for coding tasks. Use it when the user asks you to write, modify, debug, or run code.`
      : `You are Jan, an AI assistant that helps users with coding and general tasks.

When you detect that a task involves coding work (writing, modifying, debugging, or running code), you MUST use the opencode_delegate tool to delegate the work to the specialized coding agent.

For general questions, explanations, or non-coding tasks, respond directly without using tools.

## When to use opencode_delegate:
- Writing new code or files
- Modifying existing code
- Running shell commands (npm, git, cargo, make, etc.)
- Debugging or fixing bugs
- Creating new components, modules, or features
- File system operations on source code
- Multi-step development workflows

## When NOT to use opencode_delegate:
- Answering questions about code concepts
- Explaining how something works
- General conversation
- Information lookup or research

Always be helpful and concise in your responses.`

    let streamStartTime: number | undefined
    let textDeltaCount = 0

    console.log('[Orchestrator] Starting with tools:', Object.keys(allTools))
    console.log('[Orchestrator] System prompt length:', orchestratorSystemPrompt.length)

    const result = streamText({
      model: this.model,
      messages: modelMessages,
      abortSignal: options.abortSignal,
      tools: allTools,
      toolChoice: 'auto',
      system: orchestratorSystemPrompt,
    })

    return result.toUIMessageStream({
      messageMetadata: ({ part }) => {
        console.log('[Orchestrator] Stream part:', part.type)

        if (!streamStartTime) {
          streamStartTime = Date.now()
        }

        if (part.type === 'text-delta') {
          textDeltaCount++
          if (this.onStreamingTokenSpeed) {
            const elapsedMs = Date.now() - streamStartTime
            this.onStreamingTokenSpeed(textDeltaCount, elapsedMs)
          }
        }

        if (part.type === 'finish') {
          const finishPart = part as {
            type: 'finish'
            totalUsage: LanguageModelUsage
            finishReason: string
            providerMetadata?: {
              llamacpp?: {
                promptTokens?: number | null
                completionTokens?: number | null
                tokensPerSecond?: number | null
              }
            }
          }
          const usage = finishPart.totalUsage
          const llamacppMeta = finishPart.providerMetadata?.llamacpp
          const durationMs = streamStartTime ? Date.now() - streamStartTime : 0
          const durationSec = durationMs / 1000

          const outputTokens =
            usage?.outputTokens ??
            llamacppMeta?.completionTokens ??
            textDeltaCount
          const inputTokens = usage?.inputTokens ?? llamacppMeta?.promptTokens

          let tokenSpeed: number
          if (llamacppMeta?.tokensPerSecond != null) {
            tokenSpeed = llamacppMeta.tokensPerSecond
          } else if (durationSec > 0 && outputTokens > 0) {
            tokenSpeed = outputTokens / durationSec
          } else {
            tokenSpeed = 0
          }

          // Mark orchestrator as completed
          setStatus('completed')
          addEvent({
            id: `step-complete-${Date.now()}`,
            source: 'ai-sdk',
            timestamp: Date.now(),
            type: 'step.completed',
            data: { step: 1 },
          })

          return {
            usage: {
              inputTokens: inputTokens,
              outputTokens: outputTokens,
              totalTokens: usage?.totalTokens ?? (inputTokens ?? 0) + outputTokens,
            },
            tokenSpeed: {
              tokenSpeed: Math.round(tokenSpeed * 10) / 10,
              tokenCount: outputTokens,
              durationMs,
            },
          }
        }

        return undefined
      },
      onError: (error) => {
        setStatus('error')
        if (error == null) return 'Unknown error'
        if (typeof error === 'string') return error
        if (error instanceof Error) return error.message
        return JSON.stringify(error)
      },
      onFinish: ({ responseMessage }) => {
        if (responseMessage) {
          const metadata = responseMessage.metadata as
            | Record<string, unknown>
            | undefined
          const usage = metadata?.usage as LanguageModelUsage | undefined
          if (usage) {
            this.onTokenUsage?.(usage, responseMessage.id)
          }
        }
      },
    })
  }

  // ============================================================================
  // Reconnection (Not Supported)
  // ============================================================================

  async reconnectToStream(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: {
      chatId: string
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  mapUserInlineAttachments(messages: UIMessage[]): UIMessage[] {
    return messages.map((message) => {
      if (message.role === 'user') {
        const metadata = message.metadata as
          | {
              inline_file_contents?: Array<{ name?: string; content?: string }>
            }
          | undefined
        const inlineFileContents = Array.isArray(metadata?.inline_file_contents)
          ? metadata.inline_file_contents.filter((f) => f?.content)
          : []

        if (inlineFileContents.length > 0) {
          const buildInlineText = (base: string) => {
            if (!inlineFileContents.length) return base
            const formatted = inlineFileContents
              .map((f) => `File: ${f.name || 'attachment'}\n${f.content ?? ''}`)
              .join('\n\n')
            return base ? `${base}\n\n${formatted}` : formatted
          }

          if (message.parts.length > 0) {
            const parts = message.parts.map((part) => {
              if (part.type === 'text') {
                return {
                  type: 'text' as const,
                  text: buildInlineText(part.text ?? ''),
                }
              }
              return part
            })
            message.parts = parts
          }
        }
      }

      return message
    })
  }
}
