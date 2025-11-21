import {
  RouterStrategy,
  RouteContext,
  RouteDecision,
  AvailableModel,
} from '@janhq/core'

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
    const query = this.getMessageContent(lastMessage)

    // Build routing prompt
    const routingPrompt = this.buildRoutingPrompt(query, availableModels)

    try {
      // For now, fallback to heuristic approach
      // Full LLM-based routing would require access to EngineManager
      // which needs to be injected or accessed via window.core
      console.log('[LLMRouter] LLM-based routing not fully implemented, using fallback')
      
      // Simple fallback: select first model with chat capability
      const fallbackModel = availableModels.find(m => 
        m.capabilities.includes('chat')
      ) || availableModels[0]

      if (!fallbackModel) {
        throw new Error('No models available for routing')
      }

      return {
        modelId: fallbackModel.id,
        providerId: fallbackModel.providerId,
        confidence: 0.5,
        reasoning: 'Fallback selection (LLM routing not fully implemented)',
        metadata: {
          strategy: 'llm-based',
          fallback: true,
        },
      }
    } catch (error) {
      console.error('[LLMRouter] Routing failed, using fallback:', error)
      // Fallback to first available model
      const fallbackModel = availableModels[0]
      if (!fallbackModel) {
        throw new Error('No models available for routing')
      }
      
      return {
        modelId: fallbackModel.id,
        providerId: fallbackModel.providerId,
        confidence: 0.3,
        reasoning: 'Fallback due to routing error',
        metadata: {
          strategy: 'llm-based',
          error: String(error),
        },
      }
    }
  }

  private getMessageContent(message: any): string {
    if (typeof message.content === 'string') {
      return message.content
    }
    if (Array.isArray(message.content)) {
      return message.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join(' ')
    }
    return ''
  }

  private buildRoutingPrompt(query: string, models: AvailableModel[]): string {
    const modelList = models
      .map(
        (m, idx) =>
          `${idx + 1}. ${m.id} (${m.capabilities.join(', ')}) - ${
            m.metadata.parameterCount || 'unknown size'
          }`
      )
      .join('\n')

    return `
Query: "${query}"

Available models:
${modelList}

Which model (by number) is best for this query? Respond with ONLY the number and a brief reason.
Format: <number>|<reason>
Example: 2|Best for coding tasks
`.trim()
  }

  private parseRouterResponse(response: any, models: AvailableModel[]): RouteDecision {
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
        metadata: {
          strategy: 'llm-based',
        },
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
        metadata: {
          strategy: 'llm-based',
        },
      }
    }

    const selected = models[modelIndex]

    return {
      modelId: selected.id,
      providerId: selected.providerId,
      confidence: 0.8, // High confidence if LLM responded
      reasoning,
      metadata: {
        strategy: 'llm-based',
      },
    }
  }
}
