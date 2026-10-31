import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { cancelAgentThreadBash, cancelAgentThreadBashStrict } from '../agentTools'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: vi.fn() }))

describe('native shell cancellation confirmation', () => {
  beforeEach(() => { vi.mocked(invoke).mockReset() })

  it('propagates an actual native invoke rejection for Close', async () => {
    const error = new Error('native cancellation failed')
    vi.mocked(invoke).mockRejectedValueOnce(error)
    await expect(cancelAgentThreadBashStrict('session')).rejects.toBe(error)
    expect(invoke).toHaveBeenCalledWith('plugin:agent-tools|cancel_thread_bash', { threadId: 'session' })
  })

  it('preserves best-effort Stop on native invoke rejection', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('native cancellation failed'))
      await expect(cancelAgentThreadBash('session')).resolves.toBeUndefined()
      expect(warning).toHaveBeenCalled()
    } finally {
      warning.mockRestore()
    }
  })
})
