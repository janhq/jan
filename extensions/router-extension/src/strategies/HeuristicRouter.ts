import {
  RouterStrategy,
  RouteContext,
  RouteDecision,
  AvailableModel,
} from '@janhq/core'

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
    const query = this.getMessageContent(lastMessage).toLowerCase()

    // Scoring system for each model
    const scores = availableModels.map((model) => ({
      model,
      score: this.scoreModel(model, query, attachments, activeModels, context),
    }))

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score)

    const best = scores[0]

    if (!best) {
      throw new Error('No models available for routing')
    }

    return {
      modelId: best.model.id,
      providerId: best.model.providerId,
      confidence: best.score / 100, // Normalize to 0-1
      reasoning: this.explainScore(best.model, query, attachments),
      metadata: {
        allScores: scores.map((s) => ({ id: s.model.id, score: s.score })),
        strategy: 'heuristic',
      },
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

  private scoreModel(
    model: AvailableModel,
    query: string,
    attachments: RouteContext['attachments'],
    activeModels: string[],
    context: RouteContext
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
      if (params <= 8) score += 50
      else if (params <= 15) score += 10
    }

    // 3. Context window requirements
    const estimatedTokens = this.estimateTokenCount(query)
    if (model.metadata.contextWindow && model.metadata.contextWindow >= estimatedTokens * 2) {
      score += 10
    }

    // 4. Already loaded bonus (CRITICAL - avoid model switching and ensure usability)
    if (model.metadata.isLoaded) {
      score += 20 // Strong preference for loaded models to avoid "No active session" errors
    }
    
    // Also check activeModels array for backwards compatibility
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
      'code',
      'function',
      'class',
      'debug',
      'implement',
      'algorithm',
      'programming',
      'script',
      'syntax',
      'import',
      'export',
      'const',
      'let',
      'var',
      'def',
      'return',
      'if',
      'else',
      'for',
      'while',
    ]
    return codeKeywords.some((kw) => query.includes(kw))
  }

  private isReasoningQuery(query: string): boolean {
    const reasoningKeywords = [
      'why',
      'explain',
      'analyze',
      'compare',
      'evaluate',
      'think',
      'reason',
      'logic',
      'prove',
      'deduce',
    ]
    return reasoningKeywords.some((kw) => query.includes(kw))
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
