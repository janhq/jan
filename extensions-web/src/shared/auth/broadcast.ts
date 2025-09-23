/**
 * Authentication Broadcast Channel Handler
 * Manages both cross-tab and same-tab communication for auth state changes
 *
 * Architecture:
 * - BroadcastChannel API: For cross-tab communication
 * - LocalBroadcastChannel: For same-tab communication via CustomEvents
 */

import { AUTH_BROADCAST_CHANNEL, AUTH_EVENT_NAME, AUTH_EVENTS } from './const'
import type { AuthBroadcastMessage } from './types'

/**
 * LocalBroadcastChannel - Handles same-tab communication via custom events
 * Mimics the BroadcastChannel API but uses CustomEvents internally
 * This is needed because BroadcastChannel doesn't deliver messages to the same context
 */
class LocalBroadcastChannel {
  private eventName: string

  constructor(eventName: string) {
    this.eventName = eventName
  }

  /**
   * Post a message via custom event (same-tab only)
   */
  postMessage(data: any): void {
    const customEvent = new CustomEvent(this.eventName, {
      detail: data
    })
    window.dispatchEvent(customEvent)
  }

  /**
   * Listen for custom events
   */
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void {
    const customEventListener = (event: Event) => {
      const customEvent = event as CustomEvent
      // Convert CustomEvent to MessageEvent format for consistency
      const messageEvent = {
        data: customEvent.detail
      } as MessageEvent
      listener(messageEvent)
    }
    window.addEventListener(this.eventName, customEventListener)
  }

  /**
   * Remove custom event listener
   */
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void {
    // Note: This won't work perfectly due to function reference issues
    // In practice, we handle this with cleanup functions in AuthBroadcast
    window.removeEventListener(this.eventName, listener as any)
  }
}

export class AuthBroadcast {
  private broadcastChannel: BroadcastChannel | null = null
  private localBroadcastChannel: LocalBroadcastChannel

  constructor() {
    this.setupBroadcastChannel()
    this.localBroadcastChannel = new LocalBroadcastChannel(AUTH_EVENT_NAME)
  }

  /**
   * Setup broadcast channel for cross-tab sync
   */
  private setupBroadcastChannel(): void {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL)
      } catch (error) {
        console.warn('BroadcastChannel not available:', error)
      }
    }
  }

  /**
   * Broadcast auth event to all tabs (including current)
   */
  broadcastEvent(type: AuthBroadcastMessage): void {
    const message = { type }

    // Broadcast to other tabs via BroadcastChannel
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(message)
      } catch (error) {
        console.warn('Failed to broadcast auth event:', error)
      }
    }

    // Also broadcast to same tab via LocalBroadcastChannel
    this.localBroadcastChannel.postMessage(message)
  }

  /**
   * Broadcast login event
   */
  broadcastLogin(): void {
    this.broadcastEvent(AUTH_EVENTS.LOGIN)
  }

  /**
   * Broadcast logout event
   */
  broadcastLogout(): void {
    this.broadcastEvent(AUTH_EVENTS.LOGOUT)
  }

  /**
   * Subscribe to auth events (from all sources)
   */
  onAuthEvent(
    listener: (event: MessageEvent<{ type: AuthBroadcastMessage }>) => void
  ): () => void {
    const cleanupFunctions: Array<() => void> = []

    // Subscribe to BroadcastChannel for cross-tab events
    if (this.broadcastChannel) {
      this.broadcastChannel.addEventListener('message', listener)
      cleanupFunctions.push(() => {
        this.broadcastChannel?.removeEventListener('message', listener)
      })
    }

    // Subscribe to LocalBroadcastChannel for same-tab events
    // We need to keep track of the actual listener function for proper cleanup
    const localEventListener = (event: Event) => {
      const customEvent = event as CustomEvent
      const messageEvent = {
        data: customEvent.detail
      } as MessageEvent<{ type: AuthBroadcastMessage }>
      listener(messageEvent)
    }

    // Add listener directly to window since LocalBroadcastChannel's removeEventListener has limitations
    window.addEventListener(AUTH_EVENT_NAME, localEventListener)
    cleanupFunctions.push(() => {
      window.removeEventListener(AUTH_EVENT_NAME, localEventListener)
    })

    // Return combined cleanup function
    return () => {
      cleanupFunctions.forEach(cleanup => cleanup())
    }
  }

  /**
   * Get the broadcast channel for external listeners
   */
  getBroadcastChannel(): BroadcastChannel | null {
    return this.broadcastChannel
  }

  /**
   * Cleanup broadcast channel
   */
  destroy(): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.close()
      this.broadcastChannel = null
    }
  }
}
