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
