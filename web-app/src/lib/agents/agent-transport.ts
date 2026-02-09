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
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
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

const UNIFIED_SYSTEM_PROMPT = `You are Jan, an intelligent AI assistant with specialized agent capabilities.

# CRITICAL DELEGATION POLICY

## ALWAYS Use opencode_delegate For:
You MUST delegate to opencode_delegate when the user's request involves:
- ANY file creation, modification, or deletion
- ANY shell command execution (npm, git, cargo, pytest, etc.)
- ANY code writing, refactoring, or debugging
- Multi-file operations or codebase changes
- Running tests, builds, or development workflows
- Creating components, modules, or features
- Bug fixes, refactoring, or code improvements

IMPORTANT: Even if the task seems "simple" (like creating a single file),
you MUST use opencode_delegate. Do NOT attempt to write code yourself.

## Direct Response For:
- Pure Q&A about concepts (no file/code changes)
- Explanations and tutorials
- General conversation
- Simple greetings

## Use RAG tools when:
- Searching uploaded documents
- Querying knowledge base

## Use MCP tools when:
- Database queries
- Browser automation
- External service integrations

When in doubt between direct response and opencode_delegate, choose opencode_delegate.`

// ============================================================================
// Intent Classification
// ============================================================================

type UserIntent = 'coding' | 'qa' | 'other'

function classifyUserIntent(message: string): UserIntent {
  const codingKeywords = [
    'create', 'write', 'build', 'implement', 'add', 'modify',
    'edit', 'fix', 'debug', 'refactor', 'test', 'run', 'execute',
    'install', 'deploy', 'setup', 'configure', 'file', 'component',
    'delete', 'remove', 'rename', 'move', 'copy', 'update',
    'change', 'refactor', 'optimize', 'improve', 'analyze',
  ]

  const lowerMsg = message.toLowerCase()
  const hasCodingKeyword = codingKeywords.some((kw) => lowerMsg.includes(kw))

  // Check for file paths or code snippets
  const hasFilePath = /[./]\w+\.(ts|js|py|rs|go|java|cpp|c|h|vue|jsx|tsx)/.test(message)
  const hasCodeBlock = message.includes('```')

  if (hasCodingKeyword || hasFilePath || hasCodeBlock) {
    return 'coding'
  }

  // Q&A patterns
  const qaKeywords = ['what is', 'how does', 'explain', 'tell me about', 'why', 'describe']
  if (qaKeywords.some((kw) => lowerMsg.includes(kw))) {
    return 'qa'
  }

  return 'other'
}

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

  // Session management for conversation continuity
  private currentSessionId: string | null = null
  private previousProjectPath: string | null = null
  private sessionTimeoutMs = 10 * 60 * 1000 // 10 minutes

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

    // Get provider info from the current model settings for OpenCode to use.
    // OpenCode must use the SAME provider configuration as the main Jan chat:
    // - For local models: Jan's local API server (llama.cpp)
    // - For remote providers: Direct connection to provider API with same base_url and api_key
    const currentProvider = useModelProvider.getState().getProviderByName(
      useModelProvider.getState().selectedProvider
    )
    const providerName = useModelProvider.getState().selectedProvider
    const selectedModelId = useModelProvider.getState().selectedModel?.id

    // Determine if this is a local model or remote provider
    const localServer = useLocalApiServer.getState()
    const host = localServer.serverHost || '127.0.0.1'
    const port = localServer.serverPort || 1337
    const prefix = localServer.apiPrefix || '/v1'
    const localServerUrl = `http://${host}:${port}${prefix}`

    // Use provider's base_url if it's a remote provider, otherwise use local server
    // Remote providers have base_url like https://api.anthropic.com, https://api.openai.com, etc.
    const isLocalProvider = !currentProvider?.base_url ||
      currentProvider.base_url.includes('127.0.0.1') ||
      currentProvider.base_url.includes('localhost')
    const providerBaseUrl = isLocalProvider ? localServerUrl : currentProvider?.base_url
    // Use provider's API key for remote providers, local server's API key for local models
    const providerApiKey = isLocalProvider
      ? (localServer.apiKey || undefined)
      : (currentProvider?.api_key || undefined)

    // Determine if we should continue the existing session or create a new one
    const shouldContinueSession =
      this.currentSessionId &&
      this.previousProjectPath === this.projectPath &&
      // Check if session is still active (we'd need to track this via the session store)

    const effectiveSessionId = shouldContinueSession ? this.currentSessionId : null

    // Create agent delegate tool if project path is set
    const opencodeTool = this.projectPath
      ? createOpenCodeDelegateTool({
          projectPath: this.projectPath,
          agent: this.defaultAgent,
          autoApproveReadOnly: this.autoApproveReadOnly,
          apiKey: providerApiKey,
          providerId: providerName,
          modelId: selectedModelId,
          baseUrl: providerBaseUrl,
          sessionId: effectiveSessionId ?? undefined,
          onProgress: (event: UnifiedAgentEvent) => {
            addEvent(event)

            // Track session creation from OpenCode events
            if (event.type === 'delegation.started' && event.data.taskId) {
              // If we had a session, this task is part of it
            }
            if (event.type === 'delegation.completed' && event.data.taskId && effectiveSessionId) {
              // Task completed in session
            }
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

    // Get the last user message for intent classification
    const lastUserMessage = options.messages.findLast((m) => m.role === 'user')
    const userIntent = lastUserMessage ? classifyUserIntent(lastUserMessage.content) : 'other'

    // Use 'required' for coding tasks to force delegation, 'auto' otherwise
    const toolChoice: 'auto' | 'required' = userIntent === 'coding' ? 'required' : 'auto'

    console.log('[AgentTransport] User intent:', userIntent, '-> toolChoice:', toolChoice)

    const result = streamText({
      model: this.model,
      messages: modelMessages,
      abortSignal: options.abortSignal,
      tools: allTools,
      toolChoice,
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