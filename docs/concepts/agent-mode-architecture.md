# Agent Mode Architecture: LangChain-Powered Autonomous Assistant

## Executive Summary

This document proposes an **Agent Mode** for Jan that transforms the chat interface from a reactive "Ask" mode (current behavior) into an autonomous "Agent" mode powered by LangChain. The Agent Mode will leverage Jan's existing MCP (Model Context Protocol) tool infrastructure while adding multi-step planning, autonomous reasoning, and tool orchestration capabilities.

**Key Differentiators:**

| Feature | Ask Mode (Current) | Agent Mode (Proposed) |
|---------|-------------------|----------------------|
| **Interaction Style** | Reactive: User asks, AI responds | Autonomous: AI plans and executes multi-step tasks |
| **Tool Usage** | Tools used when explicitly needed by single response | Tools orchestrated across multiple reasoning steps |
| **Planning** | No explicit planning, direct question→answer | ReAct loop: Think→Act→Observe→Repeat |
| **User Control** | Direct control over every message | High-level task delegation with progress visibility |
| **Tool Approval** | Existing approval flow for individual tools | Batch approval for agent plan + real-time approvals |
| **Error Handling** | Single response error | Retry logic, alternative approaches, self-correction |

## 1. System Architecture

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                            │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────────────┐ │
│  │  ChatInput   │  │ Mode Toggle │  │ AgentProgressDisplay   │ │
│  │   (React)    │  │   Button    │  │   (Reasoning Steps)    │ │
│  └──────┬───────┘  └──────┬──────┘  └────────────────────────┘ │
│         │                 │                                      │
│         └─────────────────┴───────────────┐                     │
│                                            ▼                     │
│                                   ┌────────────────┐            │
│                                   │  useAgentChat  │            │
│                                   │   (New Hook)   │            │
│                                   └────────┬───────┘            │
└────────────────────────────────────────────┼────────────────────┘
                                             │
┌────────────────────────────────────────────┼────────────────────┐
│                    LangChain Layer          │                    │
│                                             ▼                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              LangChain Agent Executor                     │  │
│  │  ┌────────────┐  ┌─────────────┐  ┌──────────────────┐  │  │
│  │  │ ReAct Loop │  │ Plan Parser │  │ Memory Manager   │  │  │
│  │  │  (Think→   │  │  (Thoughts, │  │ (Agent Scratchpad│  │  │
│  │  │   Act→     │  │   Actions)  │  │  + Chat History) │  │  │
│  │  │   Observe) │  └─────────────┘  └──────────────────┘  │  │
│  │  └──────┬─────┘                                          │  │
│  └─────────┼────────────────────────────────────────────────┘  │
│            │                                                    │
│            ▼                                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │          MCP-to-LangChain Adapter Layer                  │  │
│  │  • Converts MCPTool → LangChain Tool format              │  │
│  │  • Wraps callTool() → LangChain StructuredTool.call()   │  │
│  │  • Manages tool approval flow integration                │  │
│  └──────────────────┬───────────────────────────────────────┘  │
└─────────────────────┼──────────────────────────────────────────┘
                      │
┌─────────────────────┼──────────────────────────────────────────┐
│            Existing Jan MCP Layer (No Changes)                 │
│                     ▼                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  MCP Extensions (RAG, Browser, etc.)                     │  │
│  │  • getTools() → MCPTool[]                                │  │
│  │  • callTool(name, args) → MCPToolCallResult              │  │
│  └──────────────────┬───────────────────────────────────────┘  │
│                     │                                           │
│                     ▼                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  MCP Servers (via Tauri IPC)                             │  │
│  │  • fetch, filesystem, database, etc.                     │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 Mode Switching State Management

```typescript
// web-app/src/types/chat.ts
export enum ChatMode {
  ASK = 'ask',      // Current reactive behavior
  AGENT = 'agent'   // New autonomous behavior
}

export interface ThreadAgentState {
  mode: ChatMode
  agentExecutionId?: string  // Track current agent run
  agentPlan?: AgentPlan      // Store agent's planned steps
  agentProgress: AgentStep[] // Reasoning + action history
  allowedTools?: string[]    // Tools approved for this agent run
}

export interface AgentPlan {
  goal: string
  steps: PlannedStep[]
  estimatedToolCalls: number
  requiresApproval: boolean
}

export interface PlannedStep {
  stepNumber: number
  description: string
  toolsNeeded: string[]
  completed: boolean
}

export interface AgentStep {
  type: 'thought' | 'action' | 'observation' | 'finalAnswer'
  content: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  timestamp: number
  error?: string
}
```

**State Storage:**
- **Per-Thread State**: `ThreadAgentState` stored in thread metadata (in SQL database via `threads` table `metadata` column)
- **Global UI State**: Current mode toggle via Zustand `useAppState`
- **Agent Scratchpad**: Ephemeral state in `useAgentChat` hook, cleared on completion

## 2. LangChain Integration Architecture

### 2.1 LangChain.js Setup

**Dependencies to Add:**
```json
// web-app/package.json
{
  "dependencies": {
    "langchain": "^0.3.15",
    "@langchain/core": "^0.3.30",
    "zod": "^3.23.8"  // For tool schema validation
  }
}
```

**Why LangChain.js?**
- **Browser-Compatible**: Runs in Jan's web-app React context (no Node.js backend required)
- **Model-Agnostic**: Works with any OpenAI-compatible API (Jan's LlamaCPP inference already compatible)
- **Tool Integration**: Native support for tool calling with structured schemas
- **ReAct Agent**: Built-in ReAct (Reasoning + Acting) agent implementation
- **Memory Management**: Conversation buffer and agent scratchpad handling

### 2.2 MCP-to-LangChain Adapter Implementation

```typescript
// web-app/src/lib/langchain/mcp-adapter.ts
import { DynamicStructuredTool } from 'langchain/tools'
import { z } from 'zod'
import type { MCPTool, MCPToolCallResult } from '@janhq/core'
import { serviceHub } from '@/hooks/useServiceHub'

/**
 * Converts Jan's MCPTool to LangChain DynamicStructuredTool.
 * This adapter enables LangChain agents to use existing MCP infrastructure.
 */
export class MCPToolAdapter {
  /**
   * Convert MCPTool array to LangChain tools
   */
  static async convertTools(mcpTools: MCPTool[]): Promise<DynamicStructuredTool[]> {
    return mcpTools.map((mcpTool) => this.convertSingleTool(mcpTool))
  }

  /**
   * Convert single MCPTool to LangChain DynamicStructuredTool
   */
  static convertSingleTool(mcpTool: MCPTool): DynamicStructuredTool {
    // Convert JSON Schema inputSchema to Zod schema
    const zodSchema = this.jsonSchemaToZod(mcpTool.inputSchema)

    return new DynamicStructuredTool({
      name: mcpTool.name,
      description: mcpTool.description,
      schema: zodSchema,
      
      // Wrap MCP callTool in LangChain tool execution
      func: async (input: Record<string, unknown>) => {
        try {
          // Determine which service to call based on server
          let result: MCPToolCallResult
          
          if (mcpTool.server === 'rag-internal') {
            // RAG tools (retrieve, listAttachments, getChunks)
            result = await serviceHub.rag().callTool(mcpTool.name, input)
          } else {
            // MCP server tools (fetch, filesystem, etc.)
            result = await serviceHub.mcp().callTool(mcpTool.name, input, mcpTool.server)
          }

          // Format result for LangChain
          if (result.isError) {
            return `Error: ${result.content}`
          }
          
          // Return string representation for agent observation
          return typeof result.content === 'string' 
            ? result.content 
            : JSON.stringify(result.content, null, 2)
            
        } catch (error) {
          return `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        }
      }
    })
  }

  /**
   * Convert JSON Schema to Zod schema for LangChain tool validation.
   * Handles common patterns in MCP tool schemas.
   */
  private static jsonSchemaToZod(jsonSchema: Record<string, unknown>): z.ZodObject<any> {
    const properties = (jsonSchema.properties || {}) as Record<string, any>
    const required = (jsonSchema.required || []) as string[]
    
    const zodShape: Record<string, z.ZodTypeAny> = {}
    
    for (const [key, prop] of Object.entries(properties)) {
      let zodType: z.ZodTypeAny
      
      switch (prop.type) {
        case 'string':
          zodType = z.string()
          if (prop.description) zodType = zodType.describe(prop.description)
          break
        case 'number':
          zodType = z.number()
          if (prop.description) zodType = zodType.describe(prop.description)
          break
        case 'boolean':
          zodType = z.boolean()
          if (prop.description) zodType = zodType.describe(prop.description)
          break
        case 'array':
          zodType = z.array(z.unknown())
          if (prop.description) zodType = zodType.describe(prop.description)
          break
        case 'object':
          zodType = z.record(z.unknown())
          if (prop.description) zodType = zodType.describe(prop.description)
          break
        default:
          zodType = z.unknown()
      }
      
      // Make optional if not in required array
      if (!required.includes(key)) {
        zodType = zodType.optional()
      }
      
      zodShape[key] = zodType
    }
    
    return z.object(zodShape)
  }
}
```

### 2.3 LangChain Agent Configuration

```typescript
// web-app/src/lib/langchain/agent-executor.ts
import { AgentExecutor, createReactAgent } from 'langchain/agents'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { RunnableSequence } from '@langchain/core/runnables'
import { DynamicStructuredTool } from 'langchain/tools'
import { BaseMessage, AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { MCPTool } from '@janhq/core'
import { MCPToolAdapter } from './mcp-adapter'
import { ChatOpenAI } from '@langchain/openai'

/**
 * Agent configuration for Jan's Agent Mode.
 * Uses ReAct (Reasoning + Acting) pattern for multi-step problem solving.
 */
export class JanAgentExecutor {
  private agentExecutor: AgentExecutor | null = null
  private tools: DynamicStructuredTool[] = []
  
  /**
   * Initialize agent with MCP tools and model configuration
   */
  async initialize(config: {
    mcpTools: MCPTool[]
    modelEndpoint: string  // Jan's local inference endpoint
    modelName: string
    temperature?: number
    maxIterations?: number
    systemPrompt?: string
  }): Promise<void> {
    // Convert MCP tools to LangChain tools
    this.tools = await MCPToolAdapter.convertTools(config.mcpTools)
    
    // Configure LLM to use Jan's inference endpoint
    // Jan's LlamaCPP extension exposes OpenAI-compatible API
    const llm = new ChatOpenAI({
      modelName: config.modelName,
      temperature: config.temperature || 0.7,
      openAIApiKey: 'not-needed',  // Jan doesn't require API key
      configuration: {
        baseURL: config.modelEndpoint,  // e.g., http://localhost:1337/v1
      },
    })
    
    // Create ReAct agent prompt
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', config.systemPrompt || this.getDefaultSystemPrompt()],
      ['placeholder', '{chat_history}'],
      ['human', '{input}'],
      ['placeholder', '{agent_scratchpad}'],
    ])
    
    // Create ReAct agent
    const agent = await createReactAgent({
      llm,
      tools: this.tools,
      prompt,
    })
    
    // Create executor with iteration limits
    this.agentExecutor = new AgentExecutor({
      agent,
      tools: this.tools,
      maxIterations: config.maxIterations || 10,
      verbose: true,  // Enable detailed logging for debugging
      returnIntermediateSteps: true,  // Return reasoning steps for UI display
    })
  }
  
  /**
   * Execute agent task with streaming support for real-time UI updates
   */
  async executeTask(
    input: string,
    chatHistory: BaseMessage[] = [],
    callbacks?: {
      onThought?: (thought: string) => void
      onAction?: (action: string, tool: string) => void
      onObservation?: (observation: string) => void
      onError?: (error: string) => void
      onComplete?: (result: string) => void
    }
  ): Promise<AgentExecutionResult> {
    if (!this.agentExecutor) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    
    try {
      const result = await this.agentExecutor.invoke(
        {
          input,
          chat_history: chatHistory,
        },
        {
          callbacks: [
            {
              // Stream intermediate steps to UI
              handleLLMStart: async (llm, prompts) => {
                callbacks?.onThought?.('Thinking about next step...')
              },
              handleToolStart: async (tool, input) => {
                callbacks?.onAction?.(
                  `Using tool: ${tool.name}`,
                  tool.name
                )
              },
              handleToolEnd: async (output) => {
                callbacks?.onObservation?.(output)
              },
              handleLLMError: async (err) => {
                callbacks?.onError?.(err.message)
              },
            }
          ]
        }
      )
      
      callbacks?.onComplete?.(result.output)
      
      return {
        success: true,
        output: result.output,
        intermediateSteps: result.intermediateSteps || [],
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      callbacks?.onError?.(errorMessage)
      
      return {
        success: false,
        error: errorMessage,
        intermediateSteps: [],
      }
    }
  }
  
  /**
   * Default system prompt for ReAct agent
   */
  private getDefaultSystemPrompt(): string {
    return `You are Jan, a helpful AI assistant operating in Agent Mode.

Your goal is to help users accomplish tasks through multi-step reasoning and tool usage.

REASONING PATTERN (ReAct):
1. **Thought**: Think step-by-step about what you need to do
2. **Action**: Choose a tool and specify its input
3. **Observation**: Analyze the tool's output
4. **Repeat**: Continue until you have a final answer
5. **Final Answer**: Provide complete response to user

TOOL USAGE GUIDELINES:
- Use tools purposefully - each tool call should make progress toward the goal
- Analyze tool outputs carefully before deciding next action
- If a tool fails, try alternative approaches
- Break complex tasks into smaller steps
- Explain your reasoning at each step

AVAILABLE TOOLS:
You have access to various tools including:
- RAG tools (retrieve, listAttachments, getChunks) for document search
- MCP tools (fetch, filesystem, database, etc.) for external integrations

IMPORTANT:
- Always provide a Final Answer when you've completed the task
- If you can't complete the task, explain why and what's needed
- Be transparent about your reasoning process
- Ask clarifying questions if the task is ambiguous`
  }
}

export interface AgentExecutionResult {
  success: boolean
  output?: string
  error?: string
  intermediateSteps: Array<{
    action: {
      tool: string
      toolInput: string
      log: string
    }
    observation: string
  }>
}
```

## 3. Frontend Implementation

### 3.1 Mode Toggle UI Component

```typescript
// web-app/src/containers/ChatModeToggle.tsx
import { Button } from '@/components/ui/button'
import { IconRobot, IconMessage } from '@tabler/icons-react'
import { useAppState } from '@/hooks/useAppState'
import { ChatMode } from '@/types/chat'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export const ChatModeToggle = () => {
  const chatMode = useAppState((state) => state.chatMode)
  const setChatMode = useAppState((state) => state.setChatMode)
  
  const isAgentMode = chatMode === ChatMode.AGENT
  
  return (
    <TooltipProvider>
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={!isAgentMode ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setChatMode(ChatMode.ASK)}
              className={cn('gap-2')}
            >
              <IconMessage size={16} />
              Ask
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Reactive chat: Ask questions, get direct answers</p>
          </TooltipContent>
        </Tooltip>
        
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isAgentMode ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setChatMode(ChatMode.AGENT)}
              className={cn('gap-2')}
            >
              <IconRobot size={16} />
              Agent
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Autonomous mode: Delegate tasks, AI plans and executes</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
```

**Placement in ChatInput:**
```typescript
// web-app/src/containers/ChatInput.tsx (additions)
import { ChatModeToggle } from './ChatModeToggle'

// Add to toolbar area (around line 300-400 where other buttons are)
<div className="flex items-center gap-2">
  <ChatModeToggle />
  {/* Existing buttons: attachments, tools, etc. */}
  <DropdownToolsAvailable />
  <Button onClick={handleAttachment}>...</Button>
</div>
```

### 3.2 Agent Progress Display Component

```typescript
// web-app/src/components/agent/AgentProgressDisplay.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AgentStep } from '@/types/chat'
import { IconBrain, IconTool, IconEye, IconCheck } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

interface AgentProgressDisplayProps {
  steps: AgentStep[]
  isExecuting: boolean
}

export const AgentProgressDisplay = ({ steps, isExecuting }: AgentProgressDisplayProps) => {
  if (steps.length === 0 && !isExecuting) return null
  
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <IconBrain size={16} className={cn(isExecuting && 'animate-pulse')} />
          Agent Reasoning Process
          {isExecuting && <Badge variant="secondary">Executing...</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={index} className="flex gap-3">
              <div className="flex-shrink-0 mt-1">
                {step.type === 'thought' && <IconBrain size={16} className="text-blue-500" />}
                {step.type === 'action' && <IconTool size={16} className="text-green-500" />}
                {step.type === 'observation' && <IconEye size={16} className="text-yellow-500" />}
                {step.type === 'finalAnswer' && <IconCheck size={16} className="text-purple-500" />}
              </div>
              
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {step.type}
                  </Badge>
                  {step.toolName && (
                    <Badge variant="secondary" className="text-xs">
                      {step.toolName}
                    </Badge>
                  )}
                </div>
                
                <p className="text-sm text-muted-foreground">{step.content}</p>
                
                {step.toolInput && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      Tool input
                    </summary>
                    <pre className="mt-1 rounded bg-muted p-2 overflow-x-auto">
                      {JSON.stringify(step.toolInput, null, 2)}
                    </pre>
                  </details>
                )}
                
                {step.toolOutput && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      Tool output
                    </summary>
                    <pre className="mt-1 rounded bg-muted p-2 overflow-x-auto">
                      {step.toolOutput}
                    </pre>
                  </details>
                )}
                
                {step.error && (
                  <p className="text-xs text-red-500">Error: {step.error}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
```

### 3.3 Agent Chat Hook

```typescript
// web-app/src/hooks/useAgentChat.ts
import { useState, useCallback, useRef } from 'react'
import { useAppState } from './useAppState'
import { useServiceHub } from './useServiceHub'
import { JanAgentExecutor } from '@/lib/langchain/agent-executor'
import { AgentStep, ChatMode } from '@/types/chat'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import type { MCPTool } from '@janhq/core'

export const useAgentChat = () => {
  const chatMode = useAppState((state) => state.chatMode)
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([])
  const [isAgentExecuting, setIsAgentExecuting] = useState(false)
  const agentExecutorRef = useRef<JanAgentExecutor | null>(null)
  const serviceHub = useServiceHub()
  
  /**
   * Initialize agent executor with current tools and model
   */
  const initializeAgent = useCallback(async (
    modelEndpoint: string,
    modelName: string,
    mcpTools: MCPTool[]
  ) => {
    const executor = new JanAgentExecutor()
    
    await executor.initialize({
      mcpTools,
      modelEndpoint,
      modelName,
      temperature: 0.7,
      maxIterations: 10,
    })
    
    agentExecutorRef.current = executor
  }, [])
  
  /**
   * Execute agent task with real-time step updates
   */
  const executeAgentTask = useCallback(async (
    userInput: string,
    chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ) => {
    if (chatMode !== ChatMode.AGENT) {
      throw new Error('Agent mode not enabled')
    }
    
    if (!agentExecutorRef.current) {
      throw new Error('Agent not initialized')
    }
    
    setIsAgentExecuting(true)
    setAgentSteps([])
    
    // Convert chat history to LangChain message format
    const messages = chatHistory.map(msg => 
      msg.role === 'user' 
        ? new HumanMessage(msg.content)
        : new AIMessage(msg.content)
    )
    
    try {
      const result = await agentExecutorRef.current.executeTask(
        userInput,
        messages,
        {
          onThought: (thought) => {
            setAgentSteps((prev) => [
              ...prev,
              {
                type: 'thought',
                content: thought,
                timestamp: Date.now(),
              }
            ])
          },
          onAction: (action, tool) => {
            setAgentSteps((prev) => [
              ...prev,
              {
                type: 'action',
                content: action,
                toolName: tool,
                timestamp: Date.now(),
              }
            ])
          },
          onObservation: (observation) => {
            setAgentSteps((prev) => {
              const updated = [...prev]
              const lastStep = updated[updated.length - 1]
              
              if (lastStep && lastStep.type === 'action') {
                updated.push({
                  type: 'observation',
                  content: observation,
                  toolOutput: observation,
                  timestamp: Date.now(),
                })
              }
              
              return updated
            })
          },
          onError: (error) => {
            setAgentSteps((prev) => {
              const updated = [...prev]
              const lastStep = updated[updated.length - 1]
              
              if (lastStep) {
                lastStep.error = error
              }
              
              return updated
            })
          },
          onComplete: (finalAnswer) => {
            setAgentSteps((prev) => [
              ...prev,
              {
                type: 'finalAnswer',
                content: finalAnswer,
                timestamp: Date.now(),
              }
            ])
          }
        }
      )
      
      return result
      
    } finally {
      setIsAgentExecuting(false)
    }
  }, [chatMode])
  
  return {
    initializeAgent,
    executeAgentTask,
    agentSteps,
    isAgentExecuting,
  }
}
```

## 4. Integration with Existing Systems

### 4.1 Tool Approval Flow

**Challenge**: Agent Mode makes multiple tool calls autonomously. How to balance autonomy with user control?

**Solution: Two-Level Approval System**

1. **Pre-Execution Plan Approval** (New):
   ```typescript
   // Before agent starts, show planned steps
   interface AgentPlanApproval {
     goal: string
     estimatedSteps: PlannedStep[]
     toolsRequired: string[]
     userApproval: 'pending' | 'approved' | 'rejected'
   }
   ```
   
   - Agent generates initial plan after receiving user task
   - UI displays planned steps and tools in modal
   - User approves entire plan before execution
   - User can mark specific tools as "always allow" for future runs

2. **Runtime Tool Approval** (Existing + Enhanced):
   ```typescript
   // Reuse existing useToolApproval hook
   const { requestToolApproval } = useToolApproval()
   
   // In agent executor, check approval before each tool call
   if (requiresApproval(toolName)) {
     const approved = await requestToolApproval({
       toolName,
       toolInput,
       context: 'agent-mode',  // New: differentiate agent vs ask mode
       agentStep: currentStepNumber,  // New: show step in approval UI
     })
     
     if (!approved) {
       return 'User denied tool execution'
     }
   }
   ```

**Settings Integration** (Settings → Tools):
```typescript
interface AgentModeSettings {
  autoApproveTools: string[]  // Tools that don't need approval
  requirePlanApproval: boolean  // Show plan before execution
  maxAgentIterations: number  // Safety limit
  allowedToolCategories: ('rag' | 'mcp' | 'browser' | 'filesystem')[]
}
```

### 4.2 Message Storage

**Challenge**: Agent generates many intermediate messages (thoughts, actions, observations). How to store efficiently?

**Solution: Hierarchical Message Structure**

```typescript
// web-app/src/types/message.ts
export interface AgentMessage extends Message {
  isAgentMessage: true
  agentExecutionId: string
  agentSteps: AgentStep[]  // Store all intermediate steps
  collapsedByDefault: boolean  // UI hint: collapse steps, show final answer
}
```

**SQL Schema Addition** (`src-tauri/src/core/databases/sqlite.rs`):
```sql
-- New table for agent executions
CREATE TABLE agent_executions (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,  -- Links to messages table
  goal TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'pending', 'executing', 'completed', 'failed'
  steps_json TEXT,  -- JSON array of AgentStep[]
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE INDEX idx_agent_executions_thread ON agent_executions(thread_id);
CREATE INDEX idx_agent_executions_message ON agent_executions(message_id);
```

**Storage Flow**:
1. User sends message in Agent Mode → Create `AgentMessage` with empty `agentSteps`
2. Agent executes → Update `agent_executions.steps_json` in real-time
3. Agent completes → Update `messages` table with final answer
4. UI loads → Fetch message + joined agent execution data

### 4.3 Model Inference Integration

**Challenge**: LangChain expects OpenAI-compatible API. Jan uses LlamaCPP extension.

**Solution: Jan Already Exposes OpenAI-Compatible Endpoint!**

Jan's LlamaCPP extension (`extensions/llamacpp-extension`) creates an OpenAI-compatible API server at `http://localhost:1337/v1` (configurable port).

**LangChain Configuration**:
```typescript
// web-app/src/lib/langchain/model-config.ts
import { ChatOpenAI } from '@langchain/openai'
import { useAppState } from '@/hooks/useAppState'

export const createJanLLM = (modelId: string) => {
  // Get Jan's inference endpoint from settings
  const inferenceUrl = useAppState.getState().inferenceUrl || 'http://localhost:1337'
  
  return new ChatOpenAI({
    modelName: modelId,
    temperature: 0.7,
    openAIApiKey: 'not-needed',
    configuration: {
      baseURL: `${inferenceUrl}/v1`,
    },
    // Important: Ensure function calling is enabled
    modelKwargs: {
      response_format: { type: 'json_object' },  // For structured outputs
    }
  })
}
```

**Function Calling Support**:
- LangChain agents require models with function calling capability
- Jan supports function calling via LlamaCPP's built-in tool support
- Models must support tool/function calling (e.g., Llama 3.1+, Mistral with tool support)
- Validation: Check `model.capabilities` includes `'function_calling'` before enabling Agent Mode

### 4.4 Proactive Mode Integration

**Current Proactive Mode**: Autonomous screenshot capture for vision models (see `useChat.ts` line 715-730)

**Agent Mode Enhancement**:
```typescript
// Proactive mode becomes more powerful in Agent Mode
// Agent can autonomously decide when to capture screenshots

// Example: Agent reasoning
// Thought: "User asked about their screen. I should capture a screenshot."
// Action: Use 'capture_screenshot' tool
// Observation: [Screenshot data]
// Thought: "Now I can analyze the screenshot to answer the question."
// Action: Use vision model with screenshot
// Final Answer: "I can see your screen shows..."

// Integration: Add 'capture_screenshot' as MCP tool
export const createProactiveTools = (): MCPTool[] => [
  {
    name: 'capture_screenshot',
    description: 'Capture current screen/window screenshot for analysis',
    inputSchema: {
      type: 'object',
      properties: {
        region: {
          type: 'string',
          enum: ['full_screen', 'active_window'],
          description: 'Screenshot region to capture'
        }
      }
    },
    server: 'proactive-internal'
  }
]
```

## 5. Example User Flows

### 5.1 Ask Mode (Current Behavior)

```
User: "What's in my documents about Q1 sales?"

[Single LLM call with RAG tools]
→ LLM decides to use 'retrieve' tool
→ Tool approval modal (if enabled)
→ RAG retrieval
→ LLM synthesizes answer

Response: "Based on the Q1 sales report, revenue was $1.2M..."
```

### 5.2 Agent Mode (New Behavior)

```
User: "Create a comprehensive analysis of Q1 sales and email it to the team"

[Agent Plan Generated]
Plan Preview Modal:
  Goal: Analyze Q1 sales and send email
  Steps:
    1. Search documents for Q1 sales data
    2. Extract key metrics (revenue, growth, top products)
    3. Generate analysis report
    4. Fetch team email addresses
    5. Compose and send email
  Tools Required: retrieve, getChunks, fetch, email
  
  [Approve Plan] [Reject]

[User Approves]

Agent Execution (visible in UI):

Step 1: Thought
  "I need to find Q1 sales documents first. Let me search for relevant documents."
  
Step 2: Action
  Tool: retrieve
  Input: { query: "Q1 sales revenue data", limit: 5 }
  
Step 3: Observation
  Found 3 documents: Q1_Sales_Report.pdf, Q1_Dashboard.xlsx, Sales_Summary_Q1.md
  
Step 4: Thought
  "Great! I found the sales report. Now I need to extract the actual data from these documents."
  
Step 5: Action
  Tool: getChunks
  Input: { attachmentId: "Q1_Sales_Report.pdf", limit: 10 }
  
Step 6: Observation
  Revenue: $1.2M (↑15% YoY)
  Top Product: Widget Pro ($450K)
  Units Sold: 12,500
  
Step 7: Thought
  "I have the key metrics. Now I need to get team email addresses. Let me check the team directory."
  
Step 8: Action
  Tool: fetch
  Input: { url: "https://api.company.com/team/sales" }
  
Step 9: Observation
  Team emails: [alice@company.com, bob@company.com, carol@company.com]
  
Step 10: Thought
  "Perfect! Now I can compose the analysis email with all the data."
  
Step 11: Action
  Tool: send_email
  Input: {
    to: ["alice@company.com", "bob@company.com", "carol@company.com"],
    subject: "Q1 Sales Analysis - Strong Performance",
    body: "Team,\n\nQ1 exceeded expectations with $1.2M revenue (15% growth YoY)..."
  }
  
  [Tool Approval Modal - send_email requires confirmation]
  Preview:
    To: Sales Team (3 recipients)
    Subject: Q1 Sales Analysis - Strong Performance
    [Show email body]
  
  [Approve] [Reject]
  
[User Approves]

Step 12: Observation
  Email sent successfully to 3 recipients
  
Step 13: Final Answer
  "I've completed the Q1 sales analysis and sent the email to the team. Here's what I did:
  
  1. ✅ Retrieved Q1 sales data from internal documents
  2. ✅ Extracted key metrics: $1.2M revenue (15% YoY growth), Widget Pro leading at $450K
  3. ✅ Compiled comprehensive analysis report
  4. ✅ Sent email to 3 team members: Alice, Bob, and Carol
  
  The email included all major findings and has been delivered successfully."
```

**UI Display**:
- Progress panel shows all 13 steps in collapsible format
- Each step shows timestamp and duration
- Tool inputs/outputs available in expandable sections
- Final answer prominently displayed at bottom
- Option to "Show Full Reasoning" or "Show Summary Only"

### 5.3 Error Handling & Recovery

```
User: "Download the latest market report and summarize it"

Agent Execution:

Step 1: Thought
  "I need to download the market report first. Let me search for the download URL."
  
Step 2: Action
  Tool: fetch
  Input: { url: "https://market-data.com/latest-report.pdf" }
  
Step 3: Observation
  Error: Connection timeout - server not responding
  
Step 4: Thought (Agent Self-Correction)
  "The direct fetch failed. Let me try an alternative approach - I'll search for cached versions in the user's documents."
  
Step 5: Action
  Tool: retrieve
  Input: { query: "latest market report", limit: 5 }
  
Step 6: Observation
  Found: market_report_2024_Q1.pdf (uploaded yesterday)
  
Step 7: Thought
  "Good! There's a recent report in the documents. This is likely what the user needs."
  
Step 8: Action
  Tool: getChunks
  Input: { attachmentId: "market_report_2024_Q1.pdf" }
  
Step 9: Observation
  [Report content retrieved successfully]
  
Step 10: Final Answer
  "I encountered an issue downloading the report from the external URL (connection timeout), but I found a recent version already in your documents (uploaded yesterday). Here's the summary:..."
```

**Error Handling Features**:
- Agent automatically retries with alternative strategies
- Clear error messages shown in reasoning steps
- Agent explains what went wrong and how it adapted
- User can intervene and provide guidance mid-execution

## 6. Performance & Safety Considerations

### 6.1 Token Efficiency

**Challenge**: ReAct loops generate many intermediate messages, consuming context window rapidly.

**Mitigation Strategies**:

1. **Reasoning Compression**:
   ```typescript
   // After N steps, compress reasoning history
   const compressReasoningSteps = (steps: AgentStep[], maxSteps: number = 5) => {
     if (steps.length <= maxSteps) return steps
     
     // Keep first 2 steps (initial thoughts)
     // Keep last 3 steps (recent context)
     // Summarize middle steps
     const compressed = [
       ...steps.slice(0, 2),
       {
         type: 'thought',
         content: `[Compressed: Executed ${steps.length - 5} intermediate steps including tool calls: ${
           steps.slice(2, -3).filter(s => s.type === 'action').map(s => s.toolName).join(', ')
         }]`,
         timestamp: Date.now()
       },
       ...steps.slice(-3)
     ]
     
     return compressed
   }
   ```

2. **Selective Context Window**:
   - Agent scratchpad uses separate context quota (e.g., 2048 tokens)
   - Chat history gets remaining context (e.g., 6144 tokens for 8K model)
   - Tool outputs truncated to 500 tokens max
   - Long documents summarized before adding to context

3. **Iteration Limits**:
   ```typescript
   const agentLimits = {
     maxIterations: 10,  // Hard stop after 10 steps
     maxToolCalls: 15,   // Hard stop after 15 tool calls
     maxExecutionTime: 120000,  // 2 minutes timeout
   }
   ```

### 6.2 Safety & Security

**Tool Execution Sandboxing**:
```typescript
// Dangerous tools require explicit approval
const dangerousTools = [
  'execute_code',
  'filesystem_write',
  'filesystem_delete',
  'send_email',
  'make_payment'
]

// Always require approval for dangerous tools, even in auto-approve mode
const requiresApproval = (toolName: string) => {
  return dangerousTools.includes(toolName) || !isToolAutoApproved(toolName)
}
```

**Rate Limiting**:
```typescript
// Prevent runaway agents
interface AgentRateLimits {
  maxTasksPerMinute: 5
  maxToolCallsPerTask: 15
  cooldownBetweenTasks: 5000  // 5 seconds
}
```

**User Override Controls**:
- **Emergency Stop**: Red "Stop Agent" button visible during execution
- **Step-by-Step Mode**: Execute one step at a time with manual approval
- **Pause & Resume**: Pause execution, review progress, then resume
- **Rollback**: Cancel pending tool calls if user disagrees with plan

### 6.3 Model Requirements

**Minimum Model Capabilities**:
```typescript
const isModelSuitableForAgent = (model: ThreadModel): boolean => {
  return (
    // Must support function/tool calling
    model.capabilities?.includes('function_calling') &&
    
    // Minimum context window (8K recommended for agent reasoning)
    model.metadata.context_length >= 8192 &&
    
    // Must be instruction-tuned
    model.metadata.instruction_tuned === true
  )
}
```

**Recommended Models**:
- **Llama 3.1 8B Instruct** or higher (function calling support)
- **Mistral 7B Instruct v0.3** or higher (tool support)
- **Qwen 2.5 7B Instruct** (excellent reasoning)
- **DeepSeek Coder 6.7B** (code-heavy tasks)

**UI Warning**:
```typescript
// Show warning if model not suitable
if (!isModelSuitableForAgent(selectedModel)) {
  return (
    <Alert variant="warning">
      <AlertTitle>Model Not Optimized for Agent Mode</AlertTitle>
      <AlertDescription>
        Current model ({selectedModel.name}) may not perform well in Agent Mode.
        Recommended: Switch to Llama 3.1 8B Instruct or higher for best results.
      </AlertDescription>
    </Alert>
  )
}
```

## 7. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
**Goal**: Basic LangChain integration and MCP adapter

- [ ] Install LangChain.js dependencies
- [ ] Implement `MCPToolAdapter` class
- [ ] Create `JanAgentExecutor` with ReAct agent
- [ ] Write unit tests for MCP-to-LangChain conversion
- [ ] Test against sample MCP tools (fetch, retrieve)

**Deliverables**:
- `web-app/src/lib/langchain/mcp-adapter.ts`
- `web-app/src/lib/langchain/agent-executor.ts`
- Tests proving agent can call Jan's MCP tools

### Phase 2: UI & State Management (Week 3)
**Goal**: Mode toggle and agent progress display

- [ ] Add `ChatMode` enum to types
- [ ] Implement `ChatModeToggle` component
- [ ] Create `AgentProgressDisplay` component
- [ ] Add agent state to Zustand store
- [ ] Implement `useAgentChat` hook
- [ ] Update `ChatInput` to show mode toggle

**Deliverables**:
- Mode toggle button in chat UI
- Real-time agent progress panel
- State management for agent execution

### Phase 3: Tool Approval & Safety (Week 4)
**Goal**: Two-level approval system and safety controls

- [ ] Implement plan approval modal
- [ ] Enhance `useToolApproval` for agent context
- [ ] Add agent settings panel
- [ ] Implement emergency stop button
- [ ] Add rate limiting and iteration caps
- [ ] Create dangerous tool detection

**Deliverables**:
- Pre-execution plan approval flow
- Runtime tool approval integration
- Safety controls and limits

### Phase 4: Storage & Persistence (Week 5)
**Goal**: Agent execution history and message storage

- [ ] Design `agent_executions` SQL schema
- [ ] Implement Rust Tauri commands for agent storage
- [ ] Create `AgentMessage` type and storage
- [ ] Add SQL migrations
- [ ] Implement agent history retrieval
- [ ] Test on mobile (iOS/Android SQLite)

**Deliverables**:
- Database schema for agent executions
- Persistent agent history
- Cross-platform storage tests

### Phase 5: Integration & Polish (Week 6)
**Goal**: End-to-end integration and UX refinement

- [ ] Integrate with existing `useChat` hook
- [ ] Add model capability detection
- [ ] Implement reasoning compression
- [ ] Add proactive mode integration
- [ ] Create agent mode tutorial/onboarding
- [ ] Write comprehensive documentation

**Deliverables**:
- Fully functional Agent Mode
- User documentation
- Developer documentation

### Phase 6: Testing & Optimization (Week 7-8)
**Goal**: Comprehensive testing and performance tuning

- [ ] Write E2E tests for common agent workflows
- [ ] Performance testing with various models
- [ ] Token usage optimization
- [ ] Error handling edge cases
- [ ] User acceptance testing
- [ ] Bug fixes and refinements

**Deliverables**:
- Stable, production-ready Agent Mode
- Performance benchmarks
- Test coverage reports

### Phase 7: Advanced Features (Future)
**Goal**: Enhanced agent capabilities

- [ ] Multi-agent collaboration (multiple agents working together)
- [ ] Agent memory persistence across sessions
- [ ] Custom agent templates (researcher, coder, analyst)
- [ ] Agent marketplace (share custom agent configurations)
- [ ] Advanced planning algorithms (beyond ReAct)
- [ ] Integration with external agent frameworks

## 8. Technical Challenges & Solutions

### Challenge 1: LangChain Model Compatibility

**Problem**: LangChain's `ChatOpenAI` expects OpenAI's exact API format. Jan's LlamaCPP may have slight differences.

**Solution**:
```typescript
// Create custom LangChain LLM wrapper if needed
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatGeneration, ChatResult } from '@langchain/core/outputs'
import { BaseMessage } from '@langchain/core/messages'

export class JanChatModel extends BaseChatModel {
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    // Custom logic to call Jan's inference endpoint
    // Handle any format differences
    // Return LangChain-compatible result
  }
}
```

### Challenge 2: Tool Schema Validation

**Problem**: MCP tools use JSON Schema, LangChain uses Zod. Complex schemas may not convert perfectly.

**Solution**:
- Use `json-schema-to-zod` library for robust conversion
- Fallback to `z.unknown()` for unsupported schema features
- Allow manual schema overrides in settings:
  ```typescript
  const toolSchemaOverrides: Record<string, z.ZodObject<any>> = {
    'complex_tool': z.object({
      // Manually defined Zod schema
    })
  }
  ```

### Challenge 3: Streaming Agent Responses

**Problem**: LangChain agent execution is async, but UI needs real-time updates.

**Solution**:
```typescript
// Use LangChain callbacks for streaming
import { BaseCallbackHandler } from '@langchain/core/callbacks'

class AgentStreamingCallbacks extends BaseCallbackHandler {
  onLLMStart() {
    // Update UI: "Thinking..."
  }
  
  onToolStart(tool, input) {
    // Update UI: "Using tool: X"
  }
  
  onToolEnd(output) {
    // Update UI: Show tool result
  }
  
  onAgentAction(action) {
    // Update UI: Show reasoning step
  }
}
```

### Challenge 4: Context Window Management

**Problem**: ReAct loops consume context rapidly, especially with long tool outputs.

**Solution**:
```typescript
// Implement smart context window allocation
const allocateContextWindow = (
  modelContextLength: number,
  systemPrompt: string,
  chatHistory: Message[],
  agentSteps: AgentStep[]
) => {
  const systemTokens = estimateTokens(systemPrompt)
  const maxChatTokens = Math.floor(modelContextLength * 0.5)  // 50% for chat
  const maxAgentTokens = Math.floor(modelContextLength * 0.3)  // 30% for agent
  const reservedTokens = Math.floor(modelContextLength * 0.2)  // 20% buffer
  
  const truncatedChat = truncateToTokenLimit(chatHistory, maxChatTokens)
  const truncatedAgent = truncateToTokenLimit(agentSteps, maxAgentTokens)
  
  return {
    systemPrompt,
    chatHistory: truncatedChat,
    agentScratchpad: truncatedAgent
  }
}
```

## 9. Success Metrics

### User Experience Metrics
- **Task Completion Rate**: % of agent tasks completed successfully
- **User Satisfaction**: Rating after agent execution (1-5 stars)
- **Error Recovery Rate**: % of failed steps recovered by agent
- **Average Task Duration**: Time from task start to completion
- **Tool Approval Rate**: % of tool calls approved by users

### Performance Metrics
- **Token Efficiency**: Tokens per completed task
- **Iteration Count**: Average steps to completion
- **Tool Call Accuracy**: % of tool calls that succeed
- **Context Window Utilization**: % of available context used

### Safety Metrics
- **Emergency Stops**: Frequency of user-initiated stops
- **Approval Overrides**: Rate of tool approval denials
- **Timeout Rate**: % of tasks exceeding time limits
- **Dangerous Tool Usage**: Frequency of high-risk tool calls

## 10. Future Enhancements

### 10.1 Multi-Agent Collaboration

**Concept**: Multiple specialized agents working together on complex tasks.

```typescript
// Example: Research task with multiple agents
const researchTask = {
  mainAgent: 'coordinator',  // Coordinates other agents
  subAgents: [
    { name: 'web_researcher', role: 'Search and fetch web data' },
    { name: 'data_analyst', role: 'Analyze retrieved data' },
    { name: 'writer', role: 'Synthesize findings into report' }
  ]
}

// Coordinator delegates subtasks
Coordinator: "I'll delegate this research task:
  1. web_researcher: Find top 10 articles on AI safety
  2. data_analyst: Extract key themes and statistics
  3. writer: Create comprehensive summary report"
```

### 10.2 Agent Memory & Learning

**Concept**: Agents remember successful strategies and improve over time.

```typescript
interface AgentMemory {
  taskType: string
  successfulStrategy: {
    tools: string[]
    stepPattern: string
    avgDuration: number
  }
  failures: Array<{
    error: string
    avoidance: string
  }>
}

// When starting similar task, agent recalls past success
Agent: "I've successfully completed similar tasks before by:
  1. First using 'retrieve' to gather context
  2. Then 'fetch' to get latest data
  3. Finally 'analyze' to synthesize
  I'll follow this proven pattern."
```

### 10.3 Custom Agent Templates

**Concept**: Pre-configured agents for specific use cases.

```typescript
const agentTemplates = {
  researcher: {
    systemPrompt: 'You are a thorough researcher...',
    preferredTools: ['fetch', 'retrieve', 'search'],
    maxIterations: 15,
    temperature: 0.3
  },
  coder: {
    systemPrompt: 'You are an expert programmer...',
    preferredTools: ['read_file', 'write_file', 'execute_code'],
    maxIterations: 20,
    temperature: 0.1
  },
  analyst: {
    systemPrompt: 'You are a data analyst...',
    preferredTools: ['retrieve', 'calculate', 'visualize'],
    maxIterations: 10,
    temperature: 0.5
  }
}
```

### 10.4 Agent Marketplace

**Concept**: Share and discover agent configurations.

- Users create custom agents with specific prompts, tools, and settings
- Share agents to community marketplace
- Rate and review agents
- Import popular agents with one click

## 11. Conclusion

The proposed Agent Mode architecture transforms Jan from a reactive chat assistant into an autonomous task executor while preserving its core strengths:

✅ **Leverages Existing Infrastructure**: Uses MCP tools, approval flows, and message storage  
✅ **Minimal Breaking Changes**: Additive feature, Ask Mode remains unchanged  
✅ **User Control**: Two-level approval system balances autonomy with safety  
✅ **Extensible**: LangChain provides foundation for advanced agent features  
✅ **Cross-Platform**: Works on desktop (Tauri), web, and mobile  

**Key Innovation**: The MCP-to-LangChain adapter enables Jan to use its existing tool ecosystem (RAG, browser, filesystem, database) with LangChain's powerful ReAct agent without rebuilding tools.

**Next Steps**:
1. Review this architecture with Jan core team
2. Create technical spike: Proof-of-concept with simple agent task
3. Begin Phase 1 implementation: LangChain integration and MCP adapter
4. Iterate based on testing and feedback

---

**Document Version**: 1.0  
**Last Updated**: 2024  
**Status**: Proposal - Awaiting Review  
**Author**: GitHub Copilot (via AI Assistant)  
**Related Documents**:
- `.github/copilot-instructions.md` - Jan architecture overview
- `docs/dev/llm-inference-architecture.md` - LLM inference pipeline
- `docs/concepts/model-router-architecture.md` - Model selection system
