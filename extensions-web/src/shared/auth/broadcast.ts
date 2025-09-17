/**
 * Authentication Broadcast Channel Handler
 * Manages cross-tab communication for auth state changes
 */

import { AUTH_BROADCAST_CHANNEL, AUTH_EVENTS } from './const'
import type { AuthBroadcastMessage } from './types'

export class AuthBroadcast {
  private broadcastChannel: BroadcastChannel | null = null

  constructor() {
    this.setupBroadcastChannel()
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
   * Broadcast auth event to other tabs
   */
  broadcastEvent(type: AuthBroadcastMessage): void {
    if (this.broadcastChannel) {
      try {
        const message = { type }
        this.broadcastChannel.postMessage(message)
      } catch (error) {
        console.warn('Failed to broadcast auth event:', error)
      }
    }
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
   * Subscribe to auth events
   */
  onAuthEvent(
    listener: (event: MessageEvent<{ type: AuthBroadcastMessage }>) => void
  ): () => void {
    if (this.broadcastChannel) {
      this.broadcastChannel.addEventListener('message', listener)

      // Return cleanup function
      return () => {
        this.broadcastChannel?.removeEventListener('message', listener)
      }
    }

    // Return no-op cleanup if no broadcast channel
    return () => {}
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
