# Model Router Architecture for Jan

This document provides a comprehensive architectural design for implementing an intelligent model router that can dynamically select the best model to answer user questions. The design prioritizes extensibility, allowing for easy replacement or addition of different routing strategies.

## Table of Contents

1. [Overview](#overview)
2. [Current Architecture Analysis](#current-architecture-analysis)
3. [Router Architecture Design](#router-architecture-design)
4. [Implementation Strategy](#implementation-strategy)
5. [Integration Points](#integration-points)
6. [Routing Strategies](#routing-strategies)
7. [Performance Considerations](#performance-considerations)
8. [Future Extensibility](#future-extensibility)
9. [Code Examples](#code-examples)

---

## Overview

### Problem Statement

Currently, Jan requires users to manually select a model for each conversation. An intelligent model router would:

1. **Automatically select the optimal model** based on query characteristics
2. **Route between different model types** (coding, chat, reasoning, etc.)
3. **Balance performance and cost** (latency, memory, quality)
4. **Support multiple routing strategies** that can be swapped without changing core architecture

### Goals

- ✅ **Pluggable Architecture**: Easy to swap routing strategies
- ✅ **Zero Breaking Changes**: Works alongside manual selection
- ✅ **Provider Agnostic**: Works with llamacpp, OpenAI, Anthropic, etc.
- ✅ **Observable**: Clear logging and metrics for routing decisions
- ✅ **Configurable**: User can override or configure routing behavior
- ✅ **Performant**: Minimal overhead (<100ms routing decision)

---

## Current Architecture Analysis

### Existing Model Selection Flow

```typescript
// Current flow (web-app/src/hooks/useChat.ts)
User Input
    ↓
ChatInput Component
    ↓
useChat.sendMessage()
    ├─ Uses: useModelProvider.selectedModel (manually chosen)
    ├─ Uses: useModelProvider.selectedProvider (manually chosen)
    └─ Calls: sendCompletion(model, provider, messages)
    ↓
CompletionMessagesBuilder.build()
    ↓
AIEngine.chat() (from selected provider)
    ↓
llama-server / API endpoint
    ↓
Stream response back to UI
```

**Key Observation**: Model selection happens **before** `sendMessage()` is called, stored in Zustand state (`useModelProvider`).

### Current Components

#### 1. **Model Provider State** (`web-app/src/hooks/useModelProvider.ts`)
```typescript
type ModelProviderState = {
  providers: ModelProvider[]          // All registered providers
  selectedProvider: string             // Currently selected (e.g., 'llamacpp')
  selectedModel: Model | null          // Currently selected model
  selectModelProvider: (provider, model) => void
}
```

#### 2. **AIEngine Interface** (`core/src/browser/extensions/engines/AIEngine.ts`)
```typescript
abstract class AIEngine extends BaseExtension {
  abstract readonly provider: string
  abstract list(): Promise<modelInfo[]>
  abstract load(modelId: string, settings?: any): Promise<SessionInfo>
  abstract chat(opts: chatCompletionRequest): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>>
}
```

#### 3. **EngineManager** (`core/src/browser/extensions/engines/EngineManager.ts`)
```typescript
// Singleton managing all AI engines
class EngineManager {
  private engines: Map<string, AIEngine>
  
  register(engine: AIEngine): void
  get(providerId: string): AIEngine | undefined
  list(): AIEngine[]
}
```

#### 4. **Completion Flow** (`web-app/src/lib/completion.ts`)
```typescript
export async function sendCompletion(
  model: Model,
  provider: string,
  messages: ChatCompletionMessageParam[],
  tools?: Tool[]
): Promise<ChatCompletionResponse> {
  const engine = EngineManager.instance().get(provider)
  return engine.chat({
    model: model.id,
    messages,
    tools,
    ...model.settings
  })
}
```

---

## Router Architecture Design

### Core Principles

1. **Strategy Pattern**: Router strategies are interchangeable implementations
2. **Extension-Based**: Router is an extension, follows Jan's extension system
3. **Non-Invasive**: Existing manual selection still works
4. **Observable**: All routing decisions are logged and can be monitored
5. **Async-First**: Routing can be asynchronous (e.g., LLM-based routers)

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interface                          │
│  (ChatInput, ModelCombobox with "Auto" option)              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                  Router Coordinator                          │
│  (Decides: use manual selection OR invoke router)           │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │                             │
          ↓                             ↓
┌──────────────────┐         ┌──────────────────────┐
│ Manual Selection │         │   ModelRouter        │
│  (Current Flow)  │         │   Extension          │
└──────────────────┘         └──────────┬───────────┘
                                        │
                     ┌──────────────────┼──────────────────┐
                     │                  │                  │
                     ↓                  ↓                  ↓
         ┌────────────────────┐  ┌──────────────┐  ┌──────────────┐
         │ RouterStrategy     │  │ Heuristic    │  │   LLM-Based  │
         │  (Interface)       │  │   Router     │  │    Router    │
         └────────────────────┘  └──────────────┘  └──────────────┘
                                        │                  │
                                        └─────────┬────────┘
                                                  │
                                                  ↓
                                    ┌───────────────────────────┐
                                    │  RouteDecision            │
                                    │  {                        │
                                    │    modelId: string        │
                                    │    provider: string       │
                                    │    confidence: number     │
                                    │    reasoning: string      │
                                    │  }                        │
                                    └──────────┬────────────────┘
                                               │
                                               ↓
                                    ┌───────────────────────────┐
                                    │   ModelLoader             │
                                    │   (Load selected model)   │
                                    └──────────┬────────────────┘
                                               │
                                               ↓
                                    ┌───────────────────────────┐
                                    │   AIEngine.chat()         │
                                    │   (Invoke model)          │
                                    └───────────────────────────┘
```

---

## Implementation Strategy

### Phase 1: Core Router Infrastructure

#### 1.1 Router Extension Interface

**File**: `core/src/browser/extensions/router.ts`

```typescript
import { BaseExtension, ExtensionTypeEnum } from '../extension'
import { chatCompletionRequestMessage } from './engines/AIEngine'

/**
 * Routing decision returned by a router strategy
 */
export interface RouteDecision {
  /** Selected model ID */
  modelId: string
  
  /** Provider for the model (e.g., 'llamacpp', 'openai') */
  providerId: string
  
  /** Confidence score 0-1 (1 = very confident) */
  confidence: number
  
  /** Human-readable reason for selection */
  reasoning: string
  
  /** Optional metadata for logging/debugging */
  metadata?: Record<string, unknown>
}

/**
 * Input context for routing decision
 */
export interface RouteContext {
  /** Conversation messages (user's question + history) */
  messages: chatCompletionRequestMessage[]
  
  /** Thread ID for context */
  threadId?: string
  
  /** Available models (from ModelProvider state) */
  availableModels: AvailableModel[]
  
  /** Currently active/loaded models */
  activeModels: string[]
  
  /** User preferences (optional constraints) */
  preferences?: RoutePreferences
  
  /** Attachments (images, documents) */
  attachments?: {
    images: number
    documents: number
    hasCode: boolean
  }
}

export interface AvailableModel {
  id: string
  providerId: string
  capabilities: string[]  // ['chat', 'code', 'vision', 'reasoning']
  metadata: {
    parameterCount?: string  // '7B', '70B', etc.
    contextWindow?: number
    quantization?: string
    isLoaded?: boolean
  }
}

export interface RoutePreferences {
  /** Prefer speed over quality */
  prioritizeSpeed?: boolean
  
  /** Prefer quality over speed */
  prioritizeQuality?: boolean
  
  /** Maximum acceptable latency (ms) */
  maxLatency?: number
  
  /** Exclude certain models */
  excludeModels?: string[]
  
  /** Prefer loaded models (avoid model switching) */
  preferLoaded?: boolean
}

/**
 * Abstract base class for routing strategies
 */
export abstract class RouterStrategy {
  abstract name: string
  abstract description: string
  
  /**
   * Route a request to the best model
   * @param context - Routing context with messages and available models
   * @returns Promise resolving to routing decision
   */
  abstract route(context: RouteContext): Promise<RouteDecision>
  
  /**
   * Optional: Explain why a particular model was chosen
   * @param decision - The routing decision
   * @returns Human-readable explanation
   */
  explain?(decision: RouteDecision): string {
    return decision.reasoning
  }
}

/**
 * Model Router Extension
 * Manages routing strategies and coordinates model selection
 */
export abstract class ModelRouterExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.Router
  }
  
  /**
   * Get the active routing strategy
   */
  abstract getStrategy(): RouterStrategy
  
  /**
   * Set the routing strategy
   */
  abstract setStrategy(strategy: RouterStrategy): void
  
  /**
   * Route a request using the active strategy
   */
  abstract route(context: RouteContext): Promise<RouteDecision>
}
```

#### 1.2 Router Manager (Singleton)

**File**: `core/src/browser/extensions/RouterManager.ts`

```typescript
import { ModelRouterExtension, RouterStrategy, RouteContext, RouteDecision } from './router'

/**
 * Singleton managing router extensions
 */
export class RouterManager {
  private static _instance: RouterManager
  private router: ModelRouterExtension | null = null
  private fallbackStrategy: RouterStrategy | null = null
  
  private constructor() {}
  
  static instance(): RouterManager {
    if (!RouterManager._instance) {
      RouterManager._instance = new RouterManager()
    }
    return RouterManager._instance
  }
  
  /**
   * Register a router extension
   */
  register(router: ModelRouterExtension): void {
    this.router = router
    console.log('[RouterManager] Registered router extension')
  }
  
  /**
   * Get the active router
   */
  get(): ModelRouterExtension | null {
    return this.router
  }
  
  /**
   * Route using the active router (or fallback)
   */
  async route(context: RouteContext): Promise<RouteDecision | null> {
    if (!this.router && !this.fallbackStrategy) {
      console.warn('[RouterManager] No router registered')
      return null
    }
    
    try {
      if (this.router) {
        return await this.router.route(context)
      } else if (this.fallbackStrategy) {
        return await this.fallbackStrategy.route(context)
      }
      return null
    } catch (error) {
      console.error('[RouterManager] Routing failed:', error)
      return null
    }
  }
  
  /**
   * Set fallback strategy (used when no router extension is loaded)
   */
  setFallback(strategy: RouterStrategy): void {
    this.fallbackStrategy = strategy
  }
}
```

---

### Phase 2: Routing Strategies

#### 2.1 Heuristic Router (Rule-Based)

**File**: `extensions/router-extension/src/strategies/HeuristicRouter.ts`

```typescript
import { RouterStrategy, RouteContext, RouteDecision } from '@janhq/core'

/**
 * Rule-based router using heuristics
 * Fast, deterministic, no external dependencies
 */
export class HeuristicRouter extends RouterStrategy {
  name = 'heuristic'
  description = 'Rule-based routing using query characteristics'
  
  async route(context: RouteContext): Promise<RouteDecision> {
    const { messages, availableModels, activeModels, attachments } = context
    const lastMessage = messages[messages.length - 1]
    const query = lastMessage.content?.toString().toLowerCase() || ''
    
    // Scoring system for each model
    const scores = availableModels.map(model => ({
      model,
      score: this.scoreModel(model, query, attachments, activeModels),
    }))
    
    // Sort by score descending
    scores.sort((a, b) => b.score - a.score)
    
    const best = scores[0]
    
    return {
      modelId: best.model.id,
      providerId: best.model.providerId,
      confidence: best.score / 100, // Normalize to 0-1
      reasoning: this.explainScore(best.model, query, attachments),
      metadata: {
        allScores: scores.map(s => ({ id: s.model.id, score: s.score })),
      },
    }
  }
  
  private scoreModel(
    model: AvailableModel,
    query: string,
    attachments: RouteContext['attachments'],
    activeModels: string[]
  ): number {
    let score = 50 // Base score
    
    // 1. Capability matching
    if (this.isCodeQuery(query) && model.capabilities.includes('code')) {
      score += 30
    }
    
    if (attachments?.images && model.capabilities.includes('vision')) {
      score += 40
    }
    
    if (this.isReasoningQuery(query) && model.capabilities.includes('reasoning')) {
      score += 25
    }
    
    if (model.capabilities.includes('chat')) {
      score += 10 // General chat capability
    }
    
    // 2. Model size heuristics
    if (this.isComplexQuery(query)) {
      // Prefer larger models for complex queries
      const params = this.extractParamCount(model.metadata.parameterCount)
      if (params >= 70) score += 20
      else if (params >= 30) score += 10
    } else {
      // Prefer smaller models for simple queries (faster)
      const params = this.extractParamCount(model.metadata.parameterCount)
      if (params <= 8) score += 15
      else if (params <= 15) score += 10
    }
    
    // 3. Context window requirements
    const estimatedTokens = this.estimateTokenCount(query)
    if (model.metadata.contextWindow && model.metadata.contextWindow >= estimatedTokens * 2) {
      score += 10
    }
    
    // 4. Already loaded bonus (avoid model switching overhead)
    if (activeModels.includes(model.id)) {
      score += 20
    }
    
    // 5. Penalize models not loaded (if preference set)
    if (context.preferences?.preferLoaded && !model.metadata.isLoaded) {
      score -= 30
    }
    
    return Math.max(0, Math.min(100, score))
  }
  
  private isCodeQuery(query: string): boolean {
    const codeKeywords = [
      'code', 'function', 'class', 'debug', 'implement',
      'algorithm', 'programming', 'script', 'syntax',
      'import', 'export', 'const', 'let', 'var',
    ]
    return codeKeywords.some(kw => query.includes(kw))
  }
  
  private isReasoningQuery(query: string): boolean {
    const reasoningKeywords = [
      'why', 'explain', 'analyze', 'compare', 'evaluate',
      'think', 'reason', 'logic', 'prove', 'deduce',
    ]
    return reasoningKeywords.some(kw => query.includes(kw))
  }
  
  private isComplexQuery(query: string): boolean {
    // Complex if: long query, multiple questions, technical terms
    if (query.length > 500) return true
    if ((query.match(/\?/g) || []).length > 2) return true
    return false
  }
  
  private extractParamCount(paramStr?: string): number {
    if (!paramStr) return 0
    const match = paramStr.match(/(\d+)B/)
    return match ? parseInt(match[1]) : 0
  }
  
  private estimateTokenCount(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4)
  }
  
  private explainScore(
    model: AvailableModel,
    query: string,
    attachments: RouteContext['attachments']
  ): string {
    const reasons: string[] = []
    
    if (this.isCodeQuery(query) && model.capabilities.includes('code')) {
      reasons.push('query involves coding')
    }
    
    if (attachments?.images && model.capabilities.includes('vision')) {
      reasons.push('query includes images')
    }
    
    if (this.isReasoningQuery(query) && model.capabilities.includes('reasoning')) {
      reasons.push('query requires reasoning')
    }
    
    if (model.metadata.isLoaded) {
      reasons.push('model already loaded')
    }
    
    return `Selected ${model.id} because: ${reasons.join(', ') || 'best match'}`
  }
}
```

#### 2.2 LLM-Based Router (Meta-Model)

**File**: `extensions/router-extension/src/strategies/LLMRouter.ts`

```typescript
import { RouterStrategy, RouteContext, RouteDecision } from '@janhq/core'

/**
 * LLM-based router that uses a small, fast model to decide which model to use
 * Similar to Anthropic's "routing prompt" approach
 */
export class LLMRouter extends RouterStrategy {
  name = 'llm-based'
  description = 'Uses a small LLM to intelligently route queries'
  
  private routerModelId: string
  private routerProvider: string
  
  constructor(routerModelId: string = 'phi-3-mini', routerProvider: string = 'llamacpp') {
    super()
    this.routerModelId = routerModelId
    this.routerProvider = routerProvider
  }
  
  async route(context: RouteContext): Promise<RouteDecision> {
    const { messages, availableModels } = context
    const lastMessage = messages[messages.length - 1]
    const query = lastMessage.content?.toString() || ''
    
    // Build routing prompt
    const routingPrompt = this.buildRoutingPrompt(query, availableModels)
    
    try {
      // Call the router model (small, fast model)
      const engine = EngineManager.instance().get(this.routerProvider)
      if (!engine) {
        throw new Error(`Router provider ${this.routerProvider} not found`)
      }
      
      const response = await engine.chat({
        model: this.routerModelId,
        messages: [
          {
            role: 'system',
            content: 'You are a model routing assistant. Analyze the query and select the best model.',
          },
          {
            role: 'user',
            content: routingPrompt,
          },
        ],
        temperature: 0.1, // Low temperature for consistency
        max_tokens: 100,
      })
      
      // Parse response
      const decision = this.parseRouterResponse(response, availableModels)
      return decision
      
    } catch (error) {
      console.error('[LLMRouter] Routing failed, using fallback:', error)
      // Fallback to first available model
      return {
        modelId: availableModels[0].id,
        providerId: availableModels[0].providerId,
        confidence: 0.3,
        reasoning: 'Fallback due to routing error',
      }
    }
  }
  
  private buildRoutingPrompt(query: string, models: AvailableModel[]): string {
    const modelList = models.map((m, idx) => 
      `${idx + 1}. ${m.id} (${m.capabilities.join(', ')}) - ${m.metadata.parameterCount || 'unknown size'}`
    ).join('\n')
    
    return `
Query: "${query}"

Available models:
${modelList}

Which model (by number) is best for this query? Respond with ONLY the number and a brief reason.
Format: <number>|<reason>
Example: 2|Best for coding tasks
`.trim()
  }
  
  private parseRouterResponse(
    response: any,
    models: AvailableModel[]
  ): RouteDecision {
    let text = ''
    
    // Handle streaming vs non-streaming response
    if (typeof response === 'object' && 'choices' in response) {
      text = response.choices[0]?.message?.content || ''
    } else {
      text = String(response)
    }
    
    // Parse format: "2|Best for coding tasks"
    const match = text.match(/^(\d+)\|(.+)$/)
    if (!match) {
      // Fallback if parsing fails
      return {
        modelId: models[0].id,
        providerId: models[0].providerId,
        confidence: 0.5,
        reasoning: 'Failed to parse router response',
      }
    }
    
    const modelIndex = parseInt(match[1]) - 1
    const reasoning = match[2].trim()
    
    if (modelIndex < 0 || modelIndex >= models.length) {
      return {
        modelId: models[0].id,
        providerId: models[0].providerId,
        confidence: 0.5,
        reasoning: 'Invalid model index from router',
      }
    }
    
    const selected = models[modelIndex]
    
    return {
      modelId: selected.id,
      providerId: selected.providerId,
      confidence: 0.8, // High confidence if LLM responded
      reasoning,
    }
  }
}
```

#### 2.3 Embedding-Based Router (Semantic Similarity)

**File**: `extensions/router-extension/src/strategies/EmbeddingRouter.ts`

```typescript
import { RouterStrategy, RouteContext, RouteDecision } from '@janhq/core'

/**
 * Embedding-based router using semantic similarity
 * Pre-computes embeddings for model "specialties" and matches query embeddings
 */
export class EmbeddingRouter extends RouterStrategy {
  name = 'embedding-based'
  description = 'Routes based on semantic similarity of query to model specialties'
  
  private modelSpecialties: Map<string, number[]> = new Map()
  private embeddingModel: string = 'nomic-embed-text' // Local embedding model
  
  async route(context: RouteContext): Promise<RouteDecision> {
    const { messages, availableModels } = context
    const lastMessage = messages[messages.length - 1]
    const query = lastMessage.content?.toString() || ''
    
    // Get query embedding
    const queryEmbedding = await this.getEmbedding(query)
    
    // Compute similarity scores
    const scores = availableModels.map(model => ({
      model,
      similarity: this.cosineSimilarity(
        queryEmbedding,
        this.getModelEmbedding(model)
      ),
    }))
    
    // Sort by similarity
    scores.sort((a, b) => b.similarity - a.similarity)
    
    const best = scores[0]
    
    return {
      modelId: best.model.id,
      providerId: best.model.providerId,
      confidence: best.similarity,
      reasoning: `Semantic similarity: ${(best.similarity * 100).toFixed(1)}%`,
      metadata: {
        similarities: scores.map(s => ({ id: s.model.id, score: s.similarity })),
      },
    }
  }
  
  private async getEmbedding(text: string): Promise<number[]> {
    // Call embedding model
    // This would integrate with Jan's embedding capabilities
    // For now, simplified placeholder
    return new Array(384).fill(0).map(() => Math.random())
  }
  
  private getModelEmbedding(model: AvailableModel): number[] {
    // Pre-computed or cached embeddings for model "specialty" descriptions
    // E.g., "Excellent at coding tasks in Python and JavaScript"
    if (this.modelSpecialties.has(model.id)) {
      return this.modelSpecialties.get(model.id)!
    }
    
    // Generate specialty embedding (would be pre-computed in practice)
    const specialty = this.generateSpecialtyText(model)
    // Return cached or compute
    return new Array(384).fill(0).map(() => Math.random())
  }
  
  private generateSpecialtyText(model: AvailableModel): string {
    return `Model specialized in: ${model.capabilities.join(', ')}`
  }
  
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0
    
    let dotProduct = 0
    let normA = 0
    let normB = 0
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }
}
```

---

### Phase 3: Router Extension Implementation

**File**: `extensions/router-extension/src/index.ts`

```typescript
import { ModelRouterExtension, RouterStrategy, RouteContext, RouteDecision } from '@janhq/core'
import { HeuristicRouter } from './strategies/HeuristicRouter'
import { LLMRouter } from './strategies/LLMRouter'
import { EmbeddingRouter } from './strategies/EmbeddingRouter'

export default class RouterExtension extends ModelRouterExtension {
  private activeStrategy: RouterStrategy
  private availableStrategies: Map<string, RouterStrategy>
  
  constructor() {
    super()
    
    // Initialize strategies
    this.availableStrategies = new Map([
      ['heuristic', new HeuristicRouter()],
      ['llm-based', new LLMRouter()],
      ['embedding', new EmbeddingRouter()],
    ])
    
    // Default to heuristic (fastest)
    this.activeStrategy = this.availableStrategies.get('heuristic')!
  }
  
  async onLoad() {
    console.log('[RouterExtension] Loading model router')
    
    // Register with RouterManager
    RouterManager.instance().register(this)
    
    // Load user preferences for routing strategy
    const savedStrategy = await this.loadStrategyPreference()
    if (savedStrategy && this.availableStrategies.has(savedStrategy)) {
      this.activeStrategy = this.availableStrategies.get(savedStrategy)!
    }
    
    console.log(`[RouterExtension] Active strategy: ${this.activeStrategy.name}`)
  }
  
  async onUnload() {
    console.log('[RouterExtension] Unloading model router')
  }
  
  getStrategy(): RouterStrategy {
    return this.activeStrategy
  }
  
  setStrategy(strategy: RouterStrategy): void {
    this.activeStrategy = strategy
    this.saveStrategyPreference(strategy.name)
  }
  
  setStrategyByName(name: string): boolean {
    if (this.availableStrategies.has(name)) {
      this.activeStrategy = this.availableStrategies.get(name)!
      this.saveStrategyPreference(name)
      return true
    }
    return false
  }
  
  listStrategies(): Array<{ name: string; description: string }> {
    return Array.from(this.availableStrategies.values()).map(s => ({
      name: s.name,
      description: s.description,
    }))
  }
  
  async route(context: RouteContext): Promise<RouteDecision> {
    console.log(`[RouterExtension] Routing with strategy: ${this.activeStrategy.name}`)
    
    const startTime = Date.now()
    const decision = await this.activeStrategy.route(context)
    const elapsed = Date.now() - startTime
    
    console.log(
      `[RouterExtension] Routed to ${decision.modelId} (${elapsed}ms) - ${decision.reasoning}`
    )
    
    // Log decision for analytics
    this.logRoutingDecision(decision, elapsed, context)
    
    return decision
  }
  
  private async loadStrategyPreference(): Promise<string | null> {
    // Load from settings or localStorage
    const settings = await fs.readFileSync('file://settings/router.json')
    return JSON.parse(settings)?.strategy || null
  }
  
  private async saveStrategyPreference(strategyName: string): Promise<void> {
    // Save to settings
    await fs.writeFileSync(
      'file://settings/router.json',
      JSON.stringify({ strategy: strategyName })
    )
  }
  
  private logRoutingDecision(
    decision: RouteDecision,
    elapsed: number,
    context: RouteContext
  ): void {
    // Could send to analytics, store in DB, etc.
    const logEntry = {
      timestamp: Date.now(),
      strategy: this.activeStrategy.name,
      decision,
      elapsed,
      queryLength: context.messages[context.messages.length - 1].content?.toString().length || 0,
    }
    
    // For now, just console log
    console.debug('[RouterExtension] Decision:', logEntry)
  }
}
```

---

## Integration Points

### 1. Frontend Integration (User Interface)

#### Option A: Add "Auto" Model Selection

**File**: `web-app/src/containers/ModelCombobox.tsx`

```typescript
// Add "Auto" option to model selection dropdown
const models = [
  { id: '__auto__', name: '🤖 Auto (Router)', provider: 'router' },
  ...existingModels
]

// When "Auto" is selected:
if (selectedModel.id === '__auto__') {
  // Flag to enable routing in useChat
  updateAppState({ routingEnabled: true })
} else {
  updateAppState({ routingEnabled: false })
}
```

#### Option B: Setting Toggle

**File**: `web-app/src/routes/settings/ai-routing.tsx`

```typescript
function AIRoutingSettings() {
  const [enabled, setEnabled] = useState(false)
  const [strategy, setStrategy] = useState('heuristic')
  
  return (
    <div>
      <Toggle
        checked={enabled}
        onChange={setEnabled}
        label="Enable Automatic Model Routing"
      />
      
      {enabled && (
        <Select
          value={strategy}
          onChange={setStrategy}
          options={[
            { value: 'heuristic', label: 'Heuristic (Fast)' },
            { value: 'llm-based', label: 'LLM-Based (Intelligent)' },
            { value: 'embedding', label: 'Embedding-Based (Semantic)' },
          ]}
        />
      )}
    </div>
  )
}
```

### 2. Chat Hook Integration

**File**: `web-app/src/hooks/useChat.ts`

```typescript
import { RouterManager, RouteContext } from '@janhq/core'

export function useChat() {
  const { selectedModel, selectedProvider, providers } = useModelProvider()
  const routingEnabled = useAppState(state => state.routingEnabled)
  
  const sendMessage = useCallback(async (text: string, attachments?: Attachment[]) => {
    let targetModel = selectedModel
    let targetProvider = selectedProvider
    
    // ROUTING DECISION POINT
    if (routingEnabled || selectedModel?.id === '__auto__') {
      const router = RouterManager.instance().get()
      
      if (router) {
        // Build routing context
        const context: RouteContext = {
          messages: CompletionMessagesBuilder.toCompletionParamFromThread(
            allMessages,
            systemInstruction
          ),
          threadId: currentThreadId,
          availableModels: buildAvailableModels(providers),
          activeModels: activeModelIds,
          attachments: {
            images: attachments?.filter(a => a.type === 'image').length || 0,
            documents: attachments?.filter(a => a.type === 'document').length || 0,
            hasCode: detectCodeInAttachments(attachments),
          },
          preferences: {
            preferLoaded: true, // User setting
            maxLatency: 5000,
          },
        }
        
        try {
          // Route to best model
          const decision = await router.route(context)
          
          // Update model selection
          targetModel = providers
            .find(p => p.provider === decision.providerId)
            ?.models.find(m => m.id === decision.modelId)
          
          targetProvider = decision.providerId
          
          // Show routing decision to user (optional)
          toast.info(`Routing to ${decision.modelId}: ${decision.reasoning}`)
          
          console.log('[useChat] Router decision:', decision)
          
        } catch (error) {
          console.error('[useChat] Routing failed, using manual selection:', error)
          // Fallback to manual selection
        }
      }
    }
    
    // Proceed with selected/routed model
    if (!targetModel) {
      throw new Error('No model selected')
    }
    
    // Load model if not already loaded
    if (!activeModelIds.includes(targetModel.id)) {
      await loadModel(targetModel.id, targetProvider)
    }
    
    // Send completion with routed/selected model
    return sendCompletion(targetModel, targetProvider, messages, tools)
    
  }, [selectedModel, selectedProvider, routingEnabled, ...])
  
  return { sendMessage, ... }
}

function buildAvailableModels(providers: ModelProvider[]): AvailableModel[] {
  return providers.flatMap(provider =>
    provider.models.map(model => ({
      id: model.id,
      providerId: provider.provider,
      capabilities: inferCapabilities(model),
      metadata: {
        parameterCount: extractParamCount(model.id),
        contextWindow: model.settings?.ctx_len,
        quantization: extractQuantization(model.id),
        isLoaded: activeModelIds.includes(model.id),
      },
    }))
  )
}

function inferCapabilities(model: Model): string[] {
  const caps: string[] = ['chat'] // Default
  
  if (model.id.includes('code') || model.id.includes('coder')) {
    caps.push('code')
  }
  
  if (model.id.includes('vision') || model.id.includes('llava')) {
    caps.push('vision')
  }
  
  if (model.id.includes('reasoning') || model.id.includes('qwen')) {
    caps.push('reasoning')
  }
  
  return caps
}
```

### 3. Extension Loading

**File**: `web-app/src/providers/ExtensionProvider.tsx`

```typescript
useEffect(() => {
  const loadExtensions = async () => {
    const manager = ExtensionManager.getInstance()
    
    // Register all extensions (including router)
    await manager.registerActive()
    
    // Load all extensions
    await manager.load()
    
    // Router is now available via RouterManager.instance()
  }
  
  loadExtensions()
}, [])
```

---

## Routing Strategies

### Strategy Comparison Matrix

| Strategy | Speed | Accuracy | Dependencies | Use Case |
|----------|-------|----------|--------------|----------|
| **Heuristic** | ⚡⚡⚡ Very Fast (<10ms) | ⭐⭐⭐ Good | None | Production default, resource-constrained |
| **LLM-Based** | ⚡⚡ Fast (~100-500ms) | ⭐⭐⭐⭐ Very Good | Small LLM | Complex routing decisions, high accuracy needs |
| **Embedding** | ⚡⚡ Fast (~50-100ms) | ⭐⭐⭐⭐ Very Good | Embedding model | Semantic similarity, specialized domains |
| **Hybrid** | ⚡⚡ Fast (varies) | ⭐⭐⭐⭐⭐ Excellent | Multiple | Best of all worlds |

### Hybrid Strategy (Advanced)

```typescript
export class HybridRouter extends RouterStrategy {
  name = 'hybrid'
  description = 'Combines multiple routing strategies with fallback chain'
  
  private strategies: RouterStrategy[]
  
  constructor() {
    super()
    this.strategies = [
      new HeuristicRouter(),      // Fast first pass
      new EmbeddingRouter(),      // Semantic refinement
      new LLMRouter(),            // Complex case fallback
    ]
  }
  
  async route(context: RouteContext): Promise<RouteDecision> {
    // Try heuristic first
    const heuristicDecision = await this.strategies[0].route(context)
    
    // If high confidence, use it
    if (heuristicDecision.confidence > 0.8) {
      return heuristicDecision
    }
    
    // Otherwise, try embedding-based
    const embeddingDecision = await this.strategies[1].route(context)
    
    // If both agree, high confidence
    if (embeddingDecision.modelId === heuristicDecision.modelId) {
      return {
        ...embeddingDecision,
        confidence: Math.max(embeddingDecision.confidence, heuristicDecision.confidence),
        reasoning: `Consensus between heuristic and embedding: ${embeddingDecision.reasoning}`,
      }
    }
    
    // Disagreement - use LLM as tiebreaker for complex queries
    if (this.isComplexQuery(context)) {
      return this.strategies[2].route(context)
    }
    
    // Default to embedding decision
    return embeddingDecision
  }
  
  private isComplexQuery(context: RouteContext): boolean {
    const query = context.messages[context.messages.length - 1].content?.toString() || ''
    return query.length > 500 || context.messages.length > 10
  }
}
```

---

## Performance Considerations

### 1. Caching Decisions

```typescript
class CachedRouter extends RouterStrategy {
  private cache = new Map<string, RouteDecision>()
  private ttl = 60000 // 1 minute cache
  
  async route(context: RouteContext): Promise<RouteDecision> {
    const cacheKey = this.getCacheKey(context)
    
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!
      if (Date.now() - cached.metadata.timestamp < this.ttl) {
        return cached
      }
    }
    
    const decision = await this.underlyingStrategy.route(context)
    decision.metadata = { ...decision.metadata, timestamp: Date.now() }
    this.cache.set(cacheKey, decision)
    
    return decision
  }
  
  private getCacheKey(context: RouteContext): string {
    // Hash query + capabilities needed
    const query = context.messages[context.messages.length - 1].content
    return `${query?.toString().substring(0, 100)}_${context.attachments?.images}_${context.attachments?.documents}`
  }
}
```

### 2. Async Routing (Non-Blocking)

```typescript
// Start routing in parallel with user typing
const routingPromise = router.route(context)

// Don't block UI
setTimeout(async () => {
  const decision = await routingPromise
  // Preload model in background
  preloadModel(decision.modelId)
}, 0)
```

### 3. Metrics and Monitoring

```typescript
interface RoutingMetrics {
  totalRoutes: number
  averageLatency: number
  strategyUsage: Record<string, number>
  accuracyFeedback: Array<{ decision: RouteDecision; wasCorrect: boolean }>
}

class RouterMetrics {
  private metrics: RoutingMetrics = {
    totalRoutes: 0,
    averageLatency: 0,
    strategyUsage: {},
    accuracyFeedback: [],
  }
  
  recordDecision(decision: RouteDecision, latency: number): void {
    this.metrics.totalRoutes++
    this.metrics.averageLatency = 
      (this.metrics.averageLatency * (this.metrics.totalRoutes - 1) + latency) / 
      this.metrics.totalRoutes
    
    this.metrics.strategyUsage[decision.metadata?.strategy as string] = 
      (this.metrics.strategyUsage[decision.metadata?.strategy as string] || 0) + 1
  }
  
  getMetrics(): RoutingMetrics {
    return { ...this.metrics }
  }
}
```

---

## Future Extensibility

### Adding a New Router Strategy

```typescript
// 1. Create new strategy class
export class MyCustomRouter extends RouterStrategy {
  name = 'my-custom-router'
  description = 'My custom routing logic'
  
  async route(context: RouteContext): Promise<RouteDecision> {
    // Your routing logic here
    return {
      modelId: 'best-model',
      providerId: 'llamacpp',
      confidence: 0.9,
      reasoning: 'Custom logic selected this',
    }
  }
}

// 2. Register in RouterExtension
constructor() {
  this.availableStrategies.set('my-custom', new MyCustomRouter())
}

// 3. User can select it in settings
<Select options={router.listStrategies()} />
```

### Plugging in External Routers

```typescript
// Load external router from URL or package
export class ExternalRouterLoader {
  static async loadFromURL(url: string): Promise<RouterStrategy> {
    const module = await import(url)
    return new module.default()
  }
  
  static async loadFromPackage(packageName: string): Promise<RouterStrategy> {
    const module = await import(packageName)
    return new module.RouterStrategy()
  }
}

// Usage
const externalRouter = await ExternalRouterLoader.loadFromURL('https://...')
routerExtension.availableStrategies.set('external', externalRouter)
```

### API for 3rd Party Integration

```typescript
// Expose router API via Tauri commands
#[tauri::command]
async fn set_routing_strategy(strategy: String) -> Result<(), String> {
    // Call into RouterExtension
}

#[tauri::command]
async fn get_routing_decision(context: RouteContext) -> Result<RouteDecision, String> {
    // Call router
}
```

---

## Summary

This architecture provides:

✅ **Clean Separation of Concerns**: Router is a separate extension  
✅ **Strategy Pattern**: Easy to swap routing algorithms  
✅ **Backward Compatible**: Manual selection still works  
✅ **Observable**: All decisions logged and explainable  
✅ **Performant**: Heuristic router <10ms, LLM router <500ms  
✅ **Extensible**: Add new strategies without changing core  
✅ **Provider Agnostic**: Works with any AIEngine implementation  

### Implementation Priority

1. **Phase 1** (Week 1-2): Core router infrastructure + HeuristicRouter
2. **Phase 2** (Week 3): Frontend integration (Auto mode in ModelCombobox)
3. **Phase 3** (Week 4): LLMRouter + EmbeddingRouter
4. **Phase 4** (Week 5+): Metrics, caching, advanced strategies

This design allows you to start simple (heuristic routing) and progressively add more sophisticated strategies while maintaining a consistent, pluggable architecture.
