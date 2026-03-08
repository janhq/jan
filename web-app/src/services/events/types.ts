/**
 * Events Service Types
 */

export interface EventOptions {
  [key: string]: unknown
}

export interface UnlistenFn {
  (): void
}

export interface EventsService {
  emit<T>(event: string, payload?: T, options?: EventOptions): Promise<void>
  listen<T>(event: string, handler: (event: { payload: T }) => void, options?: EventOptions): Promise<UnlistenFn>
}
