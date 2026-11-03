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

export const useChatPermissions = create<State>()((set, get) => {
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
        // Merge only when this patch reaches the host, against the last ack.
        const { shellNetwork, memoryWrite } = get()
        const value = { shellNetwork, memoryWrite, ...patch }
        const saved = await getServiceHub()
          .core()
          .invoke<ChatPermissions>('set_chat_permissions', { value })
        set({ shellNetwork: saved.shellNetwork, memoryWrite: saved.memoryWrite })
      })
    },
  }
})
