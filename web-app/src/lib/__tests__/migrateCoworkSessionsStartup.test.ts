import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  isTauri: true,
  invoke: vi.fn(),
  getServiceHub: vi.fn(),
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => h.isTauri,
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: h.getServiceHub,
}))

import {
  migrateCoworkSessionsOnStartup,
  CODE_SESSIONS_KEY,
  COWORK_MIGRATION_FLAG_KEY,
} from '../migrateCoworkSessions'

describe('migrateCoworkSessionsOnStartup', () => {
  beforeEach(() => {
    h.isTauri = true
    h.invoke.mockReset()
    h.getServiceHub.mockReset()
    h.getServiceHub.mockReturnValue({ core: () => ({ invoke: h.invoke }) })
  })

  it('does nothing outside Tauri (no backend to migrate)', async () => {
    h.isTauri = false
    await migrateCoworkSessionsOnStartup()
    expect(h.getServiceHub).not.toHaveBeenCalled()
    expect(h.invoke).not.toHaveBeenCalled()
  })

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
})
