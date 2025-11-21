import { BaseExtension, ExtensionTypeEnum } from '../extension'
import type { ChatCompletionMessage } from '../../types/inference'

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
 * Available model information for routing
 */
export interface AvailableModel {
  id: string
  providerId: string
  capabilities: string[] // ['chat', 'code', 'vision', 'reasoning']
  metadata: {
    parameterCount?: string // '7B', '70B', etc.
    contextWindow?: number
    quantization?: string
    isLoaded?: boolean
  }
}

/**
 * User preferences for routing
 */
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
 * Input context for routing decision
 */
export interface RouteContext {
  /** Conversation messages (user's question + history) */
  messages: ChatCompletionMessage[]

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
