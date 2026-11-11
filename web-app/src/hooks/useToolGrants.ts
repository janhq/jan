import { create } from 'zustand'
import {
  consentRevoke,
  consentSaved,
  consentSetAllowAllMcp,
  type GrantKind,
  type SavedGrants,
} from '@janhq/tauri-plugin-agent-tools-api'

type ToolGrantsState = SavedGrants & {
  /** Re-read the saved grants from Rust, which owns them. */
  load: () => Promise<void>
  setAllowAllMcp: (allow: boolean) => Promise<void>
  revoke: (kind: GrantKind, name: string) => Promise<void>
}

/**
 * The configuration-level tool grants ("Allow always" and "allow all MCP"), as
 * the settings page shows them. A view only: Rust keeps and enforces them, so
 * every change goes there and is read back.
 */
export const useToolGrants = create<ToolGrantsState>()((set, get) => ({
  allowAllMcp: false,
  servers: [],
  tools: [],
  load: async () => {
    try {
      set(await consentSaved())
    } catch (error) {
      console.error('Could not read saved tool permissions:', error)
    }
  },
  setAllowAllMcp: async (allow) => {
    await consentSetAllowAllMcp(allow)
    await get().load()
  },
  revoke: async (kind, name) => {
    await consentRevoke(kind, name)
    await get().load()
  },
}))
