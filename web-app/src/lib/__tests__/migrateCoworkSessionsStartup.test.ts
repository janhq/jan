import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  isTauri: true,
  isIOS: false,
  isAndroid: false,
  invoke: vi.fn(),
  getServiceHub: vi.fn(),
  copyWorkspace: vi.fn(),
  lastExtra: undefined as unknown,
  lastMessages: [] as unknown[],
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => h.isTauri,
  isPlatformIOS: () => h.isIOS,
  isPlatformAndroid: () => h.isAndroid,
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: h.getServiceHub,
}))
vi.mock('@/lib/agentTools', () => ({
  copySessionWorkspaceToThread: h.copyWorkspace,
}))

import {
  migrateCoworkSessionsOnStartup,
  CODE_SESSIONS_KEY,
  COWORK_MIGRATION_FLAG_KEY,
} from '../migrateCoworkSessions'

describe('migrateCoworkSessionsOnStartup', () => {
  beforeEach(() => {
    h.isTauri = true
    h.isIOS = false
    h.isAndroid = false
    h.invoke.mockReset()
    h.copyWorkspace.mockReset().mockResolvedValue({ copied: true })
    h.getServiceHub.mockReset()
    h.getServiceHub.mockReturnValue({ core: () => ({ invoke: h.invoke }) })
  })

  it('does nothing outside Tauri (no backend to migrate)', async () => {
    h.isTauri = false
    await migrateCoworkSessionsOnStartup()
    expect(h.getServiceHub).not.toHaveBeenCalled()
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it.each([['iOS'], ['Android']])(
    'does nothing on %s: sidecars and message replacement are desktop-only',
    async (platform) => {
      h.isIOS = platform === 'iOS'
      h.isAndroid = platform === 'Android'
      await expect(migrateCoworkSessionsOnStartup()).resolves.toBeNull()
      expect(h.getServiceHub).not.toHaveBeenCalled()
      expect(h.invoke).not.toHaveBeenCalled()
    }
  )

  it('runs the migration through the service hub invoke', async () => {
    h.invoke.mockImplementation(async (_cmd: string, args?: { key?: string }) =>
      args?.key === COWORK_MIGRATION_FLAG_KEY ? 'true' : null
    )
    const r = await migrateCoworkSessionsOnStartup()
    expect(r?.status).toBe('already-migrated')
    expect(h.invoke).toHaveBeenCalledWith('settings_get', {
      key: COWORK_MIGRATION_FLAG_KEY,
    })
    expect(h.invoke).not.toHaveBeenCalledWith('settings_get', {
      key: CODE_SESSIONS_KEY,
    })
  })

  it('never throws into startup when the service hub is unavailable', async () => {
    h.getServiceHub.mockImplementation(() => {
      throw new Error('hub not ready')
    })
    await expect(migrateCoworkSessionsOnStartup()).resolves.toBeNull()
  })

  it('never throws into startup when the backend rejects', async () => {
    h.invoke.mockRejectedValue(new Error('boom'))
    const r = await migrateCoworkSessionsOnStartup()
    expect(r?.status).toBe('partial')
  })

  it('wires the sandbox copy through the agent-tools helper, not a raw invoke', async () => {
    const envelope = JSON.stringify({
      state: {
        sessions: [
          {
            id: 's1',
            title: 'T',
            turns: [{ role: 'user', content: 'hi' }],
            messages: [
              { id: 'm', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
            ],
            updated: 1_700_000_000_000,
          },
        ],
      },
      version: 1,
    })
    h.invoke.mockImplementation(async (cmd: string, args?: { key?: string }) => {
      if (cmd === 'settings_get')
        return args?.key === CODE_SESSIONS_KEY ? envelope : null
      if (cmd === 'list_threads') return []
      if (cmd === 'read_thread_extra') return h.lastExtra
      if (cmd === 'write_thread_extra') {
        h.lastExtra = (args as unknown as { value: unknown }).value
        return undefined
      }
      if (cmd === 'replace_thread_messages') {
        h.lastMessages = (args as unknown as { messages: unknown[] }).messages
        return undefined
      }
      if (cmd === 'list_messages') return h.lastMessages
      if (cmd === 'create_thread') return (args as unknown as { thread: unknown }).thread
      return undefined
    })
    const r = await migrateCoworkSessionsOnStartup()
    expect(r?.migrated).toEqual(['s1'])
    expect(h.copyWorkspace).toHaveBeenCalledWith('s1')
    expect(h.invoke.mock.calls.map((c) => c[0])).not.toContain(
      'plugin:agent-tools|session_workspace_copy_to_thread'
    )
  })
})
