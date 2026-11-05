import { create } from 'zustand'
import { getServiceHub } from '@/hooks/useServiceHub'

/**
 * App-wide Chat permissions. The host owns the real value (it is stored in the
 * data folder and overlaid on every conversation's grant); this store only
 * mirrors it so the UI, tool advertisement and dispatch agree with what the
 * host will enforce. Both default to on, like the old Cowork behaviour.
 */
export type ChatPermissions = {
  shellNetwork: boolean
  memoryWrite: boolean
}

export const DEFAULT_CHAT_PERMISSIONS: ChatPermissions = {
  shellNetwork: true,
  memoryWrite: true,
}

type State = ChatPermissions & {
  /** Read the host's value. A failed read keeps the current mirror. */
  load: () => Promise<void>
  /** Persist through the host; the mirror changes only after the host accepts. */
  set: (next: Partial<ChatPermissions>) => Promise<void>
}

export const useChatPermissions = create<State>()((set) => {
  // Reads share the write queue so a slow load cannot overwrite a newer save.
  // Keep a recovered tail, but return the original result to each caller.
  let pending = Promise.resolve()
  const enqueue = (operation: () => Promise<void>) => {
    const result = pending.then(operation)
    pending = result.catch(() => {})
    return result
  }

  return {
    ...DEFAULT_CHAT_PERMISSIONS,
    load: () => enqueue(async () => {
      try {
        const value = await getServiceHub()
          .core()
          .invoke<ChatPermissions>('get_chat_permissions')
        if (value) set({ shellNetwork: value.shellNetwork, memoryWrite: value.memoryWrite })
      } catch (error) {
        console.warn('[chat-permissions] could not read the host setting:', error)
      }
    }),
    set: (next) => {
      const patch = { ...next }
      return enqueue(async () => {
        // Read inside the queue: the mirror may still contain defaults after a
        // failed load, or another client may have changed the host setting.
        // A failed read must reject this save rather than persist defaults.
        const { shellNetwork, memoryWrite } = await getServiceHub()
          .core()
          .invoke<ChatPermissions>('get_chat_permissions')
        const value = { shellNetwork, memoryWrite, ...patch }
        let saved: ChatPermissions
        try {
          saved = await getServiceHub()
            .core()
            .invoke<ChatPermissions>('set_chat_permissions', { value })
        } catch (error) {
          // The host applies (and keeps) a revocation before it persists, so a
          // failed save can still have changed what it enforces. Resync the
          // mirror, then surface the original error. If the resync fails too,
          // stay fail-closed: treat every side this save tried to revoke as off.
          try {
            const current = await getServiceHub()
              .core()
              .invoke<ChatPermissions>('get_chat_permissions')
            if (current) set({ shellNetwork: current.shellNetwork, memoryWrite: current.memoryWrite })
          } catch (refreshError) {
            console.warn('[chat-permissions] could not refresh after a failed save:', refreshError)
            set((state) => ({
              shellNetwork: state.shellNetwork && value.shellNetwork,
              memoryWrite: state.memoryWrite && value.memoryWrite,
            }))
          }
          throw error
        }
        set({ shellNetwork: saved.shellNetwork, memoryWrite: saved.memoryWrite })
      })
    },
  }
})
