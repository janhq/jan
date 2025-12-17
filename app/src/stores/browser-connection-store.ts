import { create } from 'zustand'
import type { ConnectionState } from '@janhq/mcp-web-client'

interface BrowserConnectionState {
  connectionState: ConnectionState
  setConnectionState: (state: ConnectionState) => void
}

export const useBrowserConnection = create<BrowserConnectionState>()((set) => ({
  connectionState: 'disconnected',
  setConnectionState: (state: ConnectionState) =>
    set({ connectionState: state }),
}))
