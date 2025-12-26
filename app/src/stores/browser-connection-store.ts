import { create } from 'zustand'
import type { ConnectionState } from '@janhq/mcp-web-client'
import { CONNECTION_STATE } from '@/constants'

interface BrowserConnectionState {
  connectionState: ConnectionState
  setConnectionState: (state: ConnectionState) => void
}

export const useBrowserConnection = create<BrowserConnectionState>()((set) => ({
  connectionState: CONNECTION_STATE.DISCONNECTED,
  setConnectionState: (state: ConnectionState) =>
    set({ connectionState: state }),
}))
