import { describe, it, expect, vi, beforeEach } from 'vitest'

// The store persists via backendStorage; stub the persist layer so the import
// is inert and no disk I/O happens in tests.
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: { settingAgentTools: 'setting-agent-tools' },
}))
vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

import { useAgentToolsConfig } from '../useAgentToolsConfig'

describe('useAgentToolsConfig', () => {
  beforeEach(() => {
    useAgentToolsConfig.setState({
      agentToolsEnabled: false,
      bashNetworkEnabled: false,
    })
  })

  it('defaults both toggles off', () => {
    expect(useAgentToolsConfig.getState().agentToolsEnabled).toBe(false)
    expect(useAgentToolsConfig.getState().bashNetworkEnabled).toBe(false)
  })

  it('toggles the agent tools switch on and off', () => {
    useAgentToolsConfig.getState().setAgentToolsEnabled(true)
    expect(useAgentToolsConfig.getState().agentToolsEnabled).toBe(true)

    useAgentToolsConfig.getState().setAgentToolsEnabled(false)
    expect(useAgentToolsConfig.getState().agentToolsEnabled).toBe(false)
  })

  it('keeps bash network and agent tools switches independent', () => {
    useAgentToolsConfig.getState().setAgentToolsEnabled(true)
    expect(useAgentToolsConfig.getState().bashNetworkEnabled).toBe(false)

    useAgentToolsConfig.getState().setBashNetworkEnabled(true)
    expect(useAgentToolsConfig.getState().bashNetworkEnabled).toBe(true)
    expect(useAgentToolsConfig.getState().agentToolsEnabled).toBe(true)
  })
})
