/**
 * Agent Transport
 *
 * Extends the CustomChatTransport to support agent-assisted responses.
 * All tools (OpenCode, MCP, RAG) are always available - the LLM decides when to use them.
 *
 * No mode toggle needed - AI SDK ToolLoopAgent with toolChoice: 'auto' handles all decisions.
 */

import type { UIMessage } from '@ai-sdk/react'
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
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
// Constants
// ============================================================================

const UNIFIED_SYSTEM_PROMPT = `You are Jan, an intelligent AI assistant.

You have access to multiple tools:
1. **opencode_delegate** - For coding tasks (write, modify, debug, run code)
2. **RAG tools** - For searching your knowledge base
3. **MCP tools** - For various integrations (filesystem, browser, database, etc.)

## When to respond directly:
- Simple greetings and small talk
- General knowledge questions not requiring tools
- Short explanations without needing to search or modify files

## When to use tools:

### Use opencode_delegate when:
- Writing new code or files
- Modifying existing code
- Running shell commands (npm, git, cargo, make, etc.)
- Debugging or fixing bugs
- Creating new components, modules, or features
- File system operations on source code
- Multi-step development workflows

### Use RAG tools when:
- Questions about uploaded documents
- Searching your knowledge base
- Finding information in previous conversations

### Use MCP tools when:
- Actions on connected services
- Database queries
- Browser automation
- Other service integrations

## Decision guidelines:
- If the user asks to write, modify, or debug code → use opencode_delegate
- If the user asks about uploaded documents or knowledge → use RAG tools
- If the user asks to perform actions (send message, query DB) → use MCP tools
- If the query is simple (greetings, basic questions) → respond directly

Always choose the most appropriate approach.`

// ============================================================================
// Agent Transport Class
// ============================================================================

/**
 * AgentChatTransport - Chat transport with AI-powered agent assistance
 *
 * All messages flow through the AI SDK with all tools available:
 * - opencode_delegate: For coding tasks
 * - MCP tools: For integrations
 * - RAG tools: For knowledge search
 *
 * The LLM automatically decides when to use tools vs direct responses.
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

  // Agent configuration (project path for agent)
  private projectPath: string | null = null
  private defaultAgent: 'build' | 'plan' | 'explore' = 'build'
  private autoApproveReadOnly: boolean = true

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
   * Configure agent settings for OpenCode delegation
   */
  setAgentConfig(config: {
    projectPath: string | null
    defaultAgent?: 'build' | 'plan' | 'explore'
    autoApproveReadOnly?: boolean
  }) {
    this.projectPath = config.projectPath ?? null
    this.defaultAgent = config.defaultAgent ?? 'build'
    this.autoApproveReadOnly = config.autoApproveReadOnly ?? true
  }

  /**
   * Get current agent configuration
   */
  getAgentConfig(): {
    projectPath: string | null
    defaultAgent: 'build' | 'plan' | 'explore'
    autoApproveReadOnly: boolean
  } {
    return {
      projectPath: this.projectPath,
      defaultAgent: this.defaultAgent,
      autoApproveReadOnly: this.autoApproveReadOnly,
    }
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
  // Message Sending - Unified Flow
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

    if (!this.model) {
      throw new Error('Model not initialized')
    }

    // Unified message processing - always includes all tools
    return this.sendMessagesWithAgent(options)
  }

  /**
   * Unified message sending with all tools available
   *
   * The LLM decides whether to:
   * - Respond directly (simple Q&A)
   * - Use OpenCode for coding tasks
   * - Use MCP/RAG tools for other tasks
   */
  private async sendMessagesWithAgent(
    options: {
      chatId: string
      messages: UIMessage[]
      abortSignal: AbortSignal | undefined
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk>> {
    // Update orchestrator state
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

    // Convert messages (async in AI SDK 6)
    const modelMessages = await convertToModelMessages(
      this.mapUserInlineAttachments(options.messages)
    )

    // Create agent delegate tool if project path is set
    const opencodeTool = this.projectPath
      ? createOpenCodeDelegateTool({
          projectPath: this.projectPath,
          agent: this.defaultAgent,
          autoApproveReadOnly: this.autoApproveReadOnly,
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
      : null

    // Combine all tools: MCP + RAG + agent (if project path set)
    const allTools: Record<string, Tool> = {
      ...this.tools,
      ...(opencodeTool ? { opencode_delegate: opencodeTool } : {}),
    }

    // Build system prompt
    const systemPrompt = this.systemMessage
      ? `${this.systemMessage}\n\n${UNIFIED_SYSTEM_PROMPT}`
      : UNIFIED_SYSTEM_PROMPT

    let streamStartTime: number | undefined
    let textDeltaCount = 0

    console.log('[AgentTransport] Starting with tools:', Object.keys(allTools))

    const result = streamText({
      model: this.model,
      messages: modelMessages,
      abortSignal: options.abortSignal,
      tools: allTools,
      toolChoice: 'auto',  // LLM decides when to use tools
      stopWhen: stepCountIs(20),  // Allow multi-step tool loop so tool results feed back to the model
      system: systemPrompt,
      onStepFinish: ({ toolCalls, toolResults }) => {
        // Track tool execution status for each step
        if (toolCalls && toolCalls.length > 0) {
          for (const tc of toolCalls) {
            if (tc.toolName !== 'opencode_delegate') {
              // OpenCode delegation manages its own status via the delegate tool
              setStatus('executing_tool')
              addEvent({
                id: `sdk-tool-start-${tc.toolCallId}`,
                source: 'ai-sdk',
                timestamp: Date.now(),
                type: 'tool.started',
                data: { tool: tc.toolName, input: tc.input as Record<string, unknown> },
              })
            }
          }
        }
        if (toolResults && toolResults.length > 0) {
          for (const tr of toolResults) {
            if (tr.toolName !== 'opencode_delegate') {
              addEvent({
                id: `sdk-tool-complete-${tr.toolCallId}`,
                source: 'ai-sdk',
                timestamp: Date.now(),
                type: 'tool.completed',
                data: { tool: tr.toolName, output: tr.output },
              })
            }
          }
          // After tool results, model will think again
          setStatus('thinking')
        }
      },
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

          // Mark as completed
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