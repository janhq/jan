import {
  ModelRouterExtension,
  RouterStrategy,
  RouteContext,
  RouteDecision,
  RouterManager,
  fs,
  joinPath,
} from '@janhq/core'
import { HeuristicRouter } from './strategies/HeuristicRouter'
import { LLMRouter } from './strategies/LLMRouter'

export default class RouterExtension extends ModelRouterExtension {
  private activeStrategy: RouterStrategy
  private availableStrategies: Map<string, RouterStrategy>

  constructor(url: string, name: string, productName?: string) {
    super(url, name, productName, true, 'Model Router Extension', '1.0.0')

    // Initialize strategies
    this.availableStrategies = new Map([
      ['heuristic', new HeuristicRouter()],
      ['llm-based', new LLMRouter()],
    ])

    // Default to heuristic (fastest)
    this.activeStrategy = this.availableStrategies.get('heuristic')!
  }

  async onLoad() {
    console.log('[RouterExtension] Loading model router')

    // Register with RouterManager - use window.core.routerManager if available (web/Tauri)
    // This ensures we use the same singleton instance across the app
    const routerManager = typeof window !== 'undefined' && window.core?.routerManager 
      ? window.core.routerManager 
      : RouterManager.instance()
    
    routerManager.register(this)
    console.log('[RouterExtension] Registered with RouterManager:', routerManager)

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
    return Array.from(this.availableStrategies.values()).map((s) => ({
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
    try {
      // Load from settings
      const settingsPath = await joinPath(['file://settings', 'router.json'])
      const settings = await fs.readFileSync(settingsPath)
      const parsed = JSON.parse(settings)
      return parsed?.strategy || null
    } catch (error) {
      // File doesn't exist or error reading
      return null
    }
  }

  private async saveStrategyPreference(strategyName: string): Promise<void> {
    try {
      // Save to settings
      const settingsPath = await joinPath(['file://settings', 'router.json'])
      await fs.writeFileSync(settingsPath, JSON.stringify({ strategy: strategyName }))
    } catch (error) {
      console.error('[RouterExtension] Failed to save strategy preference:', error)
    }
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
      queryLength:
        this.getMessageContent(context.messages[context.messages.length - 1]).length || 0,
    }

    // For now, just console log
    console.debug('[RouterExtension] Decision:', logEntry)
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
}
