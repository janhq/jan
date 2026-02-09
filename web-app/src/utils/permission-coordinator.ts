/**
 * Permission Coordinator
 *
 * Event-based system for managing permission requests from OpenCode.
 * Replaces the polling-based approach with a proper event emitter.
 *
 * Features:
 * - Async request/response handling with Promise-based API
 * - Timeout support with auto-deny
 * - Request queuing
 * - Event emission for UI integration
 */

import { EventEmitter } from 'events'

// ============================================================================
// Types
// ============================================================================

export type PermissionAction = 'allow_once' | 'allow_always' | 'deny'

export interface PermissionRequestPayload {
  permissionId: string
  sessionId: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
  description?: string
}

export interface PermissionResponse {
  action: PermissionAction
  message?: string
  timestamp: number
}

export interface PendingPermissionRequest {
  request: PermissionRequestPayload
  resolve: (response: PermissionResponse) => void
  reject: (error: Error) => void
  timeoutHandle: NodeJS.Timeout
  createdAt: number
}

// ============================================================================
// Events
// ============================================================================

export enum PermissionEvents {
  Requested = 'permission-requested',
  Responded = 'permission-responded',
  Timeout = 'permission-timeout',
  Cancelled = 'permission-cancelled',
}

// ============================================================================
// Permission Coordinator
// ============================================================================

export class PermissionCoordinator extends EventEmitter {
  private pendingRequests = new Map<string, PendingPermissionRequest>()
  private defaultTimeoutMs: number
  private autoDenyOnTimeout: boolean

  constructor(options: {
    /** Default timeout in milliseconds (default: 5 minutes) */
    defaultTimeoutMs?: number
    /** Whether to auto-deny on timeout (default: true) */
    autoDenyOnTimeout?: boolean
  } = {}) {
    super()
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5 * 60 * 1000 // 5 minutes
    this.autoDenyOnTimeout = options.autoDenyOnTimeout ?? true
  }

  /**
   * Request permission from the user.
   *
   * @param request - The permission request details
   * @param timeoutMs - Optional custom timeout (overrides default)
   * @returns Promise that resolves with the user's response
   */
  async requestPermission(
    request: PermissionRequestPayload,
    timeoutMs?: number
  ): Promise<PermissionResponse> {
    const timeout = timeoutMs ?? this.defaultTimeoutMs

    // Check if already pending
    if (this.pendingRequests.has(request.permissionId)) {
      console.warn('[PermissionCoordinator] Duplicate request:', request.permissionId)
      return { action: 'deny', message: 'Duplicate request' }
    }

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.handleTimeout(request.permissionId)
      }, timeout)

      const pendingRequest: PendingPermissionRequest = {
        request,
        resolve: (response) => {
          this.cleanup(request.permissionId)
          resolve(response)
        },
        reject: (error) => {
          this.cleanup(request.permissionId)
          reject(error)
        },
        timeoutHandle,
        createdAt: Date.now(),
      }

      this.pendingRequests.set(request.permissionId, pendingRequest)

      // Emit event for UI listeners
      this.emit(PermissionEvents.Requested, {
        permissionId: request.permissionId,
        request,
        pendingCount: this.pendingRequests.size,
      })

      console.log('[PermissionCoordinator] Permission requested:', {
        permissionId: request.permissionId,
        permission: request.permission,
        timeoutMs: timeout,
      })
    })
  }

  /**
   * Respond to a permission request.
   * This is typically called by the UI when the user clicks a button.
   *
   * @param permissionId - The permission ID to respond to
   * @param response - The user's response
   */
  respondToPermission(
    permissionId: string,
    response: PermissionResponse
  ): void {
    const pending = this.pendingRequests.get(permissionId)
    if (!pending) {
      console.warn('[PermissionCoordinator] No pending request for:', permissionId)
      // Emit event anyway for logging
      this.emit(PermissionEvents.Responded, {
        permissionId,
        response,
        found: false,
      })
      return
    }

    // Clear timeout
    clearTimeout(pending.timeoutHandle)

    // Emit event before resolving
    this.emit(PermissionEvents.Responded, {
      permissionId,
      response,
      found: true,
      duration: Date.now() - pending.createdAt,
    })

    // Resolve the pending promise
    pending.resolve(response)

    console.log('[PermissionCoordinator] Permission responded:', {
      permissionId,
      action: response.action,
    })
  }

  /**
   * Cancel a pending permission request.
   * The associated promise will be rejected.
   *
   * @param permissionId - The permission ID to cancel
   * @param reason - Optional reason for cancellation
   */
  cancelPermission(permissionId: string, reason?: string): void {
    const pending = this.pendingRequests.get(permissionId)
    if (!pending) return

    clearTimeout(pending.timeoutHandle)
    this.cleanup(permissionId)

    const error = new Error(reason ?? 'Permission request cancelled')
    pending.reject(error)

    this.emit(PermissionEvents.Cancelled, {
      permissionId,
      reason: reason ?? 'Cancelled',
    })

    console.log('[PermissionCoordinator] Permission cancelled:', permissionId, reason)
  }

  /**
   * Cancel all pending permission requests.
   *
   * @param reason - Optional reason for cancellation
   */
  cancelAll(reason?: string): void {
    for (const permissionId of this.pendingRequests.keys()) {
      this.cancelPermission(permissionId, reason)
    }
  }

  /**
   * Get the count of pending requests.
   */
  getPendingCount(): number {
    return this.pendingRequests.size
  }

  /**
   * Check if a specific request is pending.
   */
  isPending(permissionId: string): boolean {
    return this.pendingRequests.has(permissionId)
  }

  /**
   * Get all pending requests (for debugging/UI).
   */
  getPendingRequests(): PermissionRequestPayload[] {
    return Array.from(this.pendingRequests.values()).map((p) => p.request)
  }

  // --------------------------------------------------------------------------
  // Private methods
  // --------------------------------------------------------------------------

  private handleTimeout(permissionId: string): void {
    const pending = this.pendingRequests.get(permissionId)
    if (!pending) return

    const action = this.autoDenyOnTimeout ? 'deny' : 'allow_once'

    this.emit(PermissionEvents.Timeout, {
      permissionId,
      action,
      duration: Date.now() - pending.createdAt,
    })

    console.log('[PermissionCoordinator] Permission timed out:', {
      permissionId,
      action,
      duration: Date.now() - pending.createdAt,
    })

    // Auto-respond with deny
    pending.resolve({
      action,
      message: 'Timeout - auto-denied',
      timestamp: Date.now(),
    })

    this.cleanup(permissionId)
  }

  private cleanup(permissionId: string): void {
    const pending = this.pendingRequests.get(permissionId)
    if (pending) {
      clearTimeout(pending.timeoutHandle)
      this.pendingRequests.delete(permissionId)
    }
  }

  /**
   * Destroy the coordinator.
   * Cancels all pending requests and removes all listeners.
   */
  destroy(): void {
    this.cancelAll('Coordinator destroyed')
    this.removeAllListeners()
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let coordinatorInstance: PermissionCoordinator | null = null

export function getPermissionCoordinator(): PermissionCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new PermissionCoordinator()
  }
  return coordinatorInstance
}

export function createPermissionCoordinator(
  options?: ConstructorParameters<typeof PermissionCoordinator>[0]
): PermissionCoordinator {
  return new PermissionCoordinator(options)
}

// ============================================================================
// React Hook helpers
// ============================================================================

/**
 * Hook-friendly wrapper around the PermissionCoordinator.
 * For use in React components.
 */
export function usePermissionCoordinator() {
  const coordinator = getPermissionCoordinator()

  return {
    requestPermission: coordinator.requestPermission.bind(coordinator),
    respondToPermission: coordinator.respondToPermission.bind(coordinator),
    cancelPermission: coordinator.cancelPermission.bind(coordinator),
    cancelAll: coordinator.cancelAll.bind(coordinator),
    getPendingCount: coordinator.getPendingCount.bind(coordinator),
    isPending: coordinator.isPending.bind(coordinator),
    getPendingRequests: coordinator.getPendingRequests.bind(coordinator),
    on: coordinator.on.bind(coordinator),
    off: coordinator.off.bind(coordinator),
    addListener: coordinator.addListener.bind(coordinator),
    removeListener: coordinator.removeListener.bind(coordinator),
  }
}