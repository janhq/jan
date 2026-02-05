import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { OpenCodeMessage, OpenCodeServiceInterface } from './types'

/**
 * Create the OpenCode service for Tauri desktop
 */
export function createOpenCodeService(): OpenCodeServiceInterface {
  // Track active listeners for cleanup
  const listeners = new Map<string, UnlistenFn[]>()

  return {
    async startTask({ taskId, projectPath, prompt, agent, apiKey, providerId, modelId, baseUrl }) {
      const resultTaskId = await invoke<string>('opencode_spawn_task', {
        taskId,
        projectPath,
        prompt,
        agent,
        apiKey,
        providerId,
        modelId,
        baseUrl,
      })
      return resultTaskId
    },

    async cancelTask(taskId) {
      await invoke('opencode_cancel_task', { taskId })
    },

    async respondToPermission(taskId, permissionId, action, message) {
      await invoke('opencode_respond_permission', {
        taskId,
        permissionId,
        action,
        message,
      })
    },

    async sendInput(taskId, text) {
      await invoke('opencode_send_input', { taskId, text })
    },

    async isTaskRunning(taskId) {
      return await invoke<boolean>('opencode_is_task_running', { taskId })
    },

    async runningTaskCount() {
      return await invoke<number>('opencode_running_task_count')
    },

    onEvent(taskId, handler) {
      let unlisten: UnlistenFn | undefined

      // Listen to task-specific events - immediately set up the listener
      const listenerPromise = listen<OpenCodeMessage>(`opencode:event:${taskId}`, (event) => {
        console.log('[OpenCode Event]', taskId, event.payload)
        handler(event.payload)
      })

      listenerPromise.then((fn) => {
        unlisten = fn
        // Track the listener for cleanup
        const existing = listeners.get(taskId) || []
        existing.push(fn)
        listeners.set(taskId, existing)
      })

      // Return cleanup function
      return () => {
        if (unlisten) {
          unlisten()
          // Remove from tracked listeners
          const existing = listeners.get(taskId) || []
          const index = existing.indexOf(unlisten)
          if (index > -1) {
            existing.splice(index, 1)
          }
          if (existing.length === 0) {
            listeners.delete(taskId)
          } else {
            listeners.set(taskId, existing)
          }
        } else {
          // If unlisten isn't set yet, wait for it and then cleanup
          listenerPromise.then((fn) => {
            fn()
            listeners.delete(taskId)
          })
        }
      }
    },

    onStatusChange(taskId, handler) {
      let unlisten: UnlistenFn | undefined

      const listenerPromise = listen<string>(`opencode:status:${taskId}`, (event) => {
        console.log('[OpenCode Status]', taskId, event.payload)
        handler(event.payload)
      })

      listenerPromise.then((fn) => {
        unlisten = fn
      })

      return () => {
        if (unlisten) {
          unlisten()
        } else {
          listenerPromise.then((fn) => fn())
        }
      }
    },
  }
}

/**
 * Singleton instance for the OpenCode service
 */
let serviceInstance: OpenCodeServiceInterface | null = null

/**
 * Get or create the OpenCode service instance
 */
export function getOpenCodeService(): OpenCodeServiceInterface {
  if (!serviceInstance) {
    serviceInstance = createOpenCodeService()
  }
  return serviceInstance
}
