import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  order: [] as string[],
  initializeServiceHub: vi.fn(),
  migrateLocalStorageToBackend: vi.fn(),
  hydrateBackendStores: vi.fn(),
  migrateCoworkSessionsOnStartup: vi.fn(),
}))

vi.mock('@/services', () => ({
  initializeServiceHub: h.initializeServiceHub,
}))
vi.mock('@/hooks/useServiceHub', () => ({
  initializeServiceHubStore: vi.fn(),
}))
vi.mock('@/lib/migrateLocalStorageSettings', () => ({
  migrateLocalStorageToBackend: h.migrateLocalStorageToBackend,
}))
vi.mock('@/lib/hydrateStores', () => ({
  hydrateBackendStores: h.hydrateBackendStores,
}))
vi.mock('@/lib/migrateCoworkSessions', () => ({
  migrateCoworkSessionsOnStartup: h.migrateCoworkSessionsOnStartup,
}))

import { ServiceHubProvider } from '../ServiceHubProvider'

describe('ServiceHubProvider', () => {
  beforeEach(() => {
    h.order.length = 0
    h.initializeServiceHub.mockReset().mockResolvedValue({})
    h.migrateLocalStorageToBackend.mockReset().mockImplementation(async () => {
      h.order.push('settings-migration')
    })
    h.hydrateBackendStores.mockReset().mockImplementation(async () => {
      h.order.push('hydrate')
    })
    h.migrateCoworkSessionsOnStartup.mockReset().mockImplementation(async () => {
      h.order.push('cowork-migration')
      return null
    })
  })

  it('migrates Cowork sessions after the stores hydrate and before children render', async () => {
    render(
      <ServiceHubProvider>
        <div data-testid="child" />
      </ServiceHubProvider>
    )
    expect(screen.queryByTestId('child')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy())
    // Children fetch threads on mount, so the migrated threads must exist by then.
    expect(h.order).toEqual(['settings-migration', 'hydrate', 'cowork-migration'])
  })

  it('still renders the app when the Cowork migration rejects', async () => {
    h.migrateCoworkSessionsOnStartup.mockRejectedValue(new Error('boom'))
    render(
      <ServiceHubProvider>
        <div data-testid="child" />
      </ServiceHubProvider>
    )
    await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy())
  })
})
