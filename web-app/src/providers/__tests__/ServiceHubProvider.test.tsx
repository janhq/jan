import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  order: [] as string[],
  initializeServiceHub: vi.fn(),
  migrateLocalStorageToBackend: vi.fn(),
  hydrateBackendStores: vi.fn(),
  startCoworkSync: vi.fn(),
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
vi.mock('@/lib/coworkSync', () => ({
  startCoworkSync: h.startCoworkSync,
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
    h.startCoworkSync.mockReset().mockImplementation(async () => {
      h.order.push('cowork-sync')
    })
  })

  it('starts the Cowork sync after the stores hydrate and before children render', async () => {
    render(
      <ServiceHubProvider>
        <div data-testid="child" />
      </ServiceHubProvider>
    )
    expect(screen.queryByTestId('child')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy())
    // Children fetch threads on mount, so the migrated threads must exist by then.
    expect(h.order).toEqual(['settings-migration', 'hydrate', 'cowork-sync'])
  })

  it('still renders the app when the Cowork sync fails to start', async () => {
    h.startCoworkSync.mockRejectedValue(new Error('boom'))
    render(
      <ServiceHubProvider>
        <div data-testid="child" />
      </ServiceHubProvider>
    )
    await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy())
  })

  it('still renders the app when service initialization fails', async () => {
    h.initializeServiceHub.mockRejectedValue(new Error('no hub'))
    render(
      <ServiceHubProvider>
        <div data-testid="child" />
      </ServiceHubProvider>
    )
    await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy())
    expect(h.startCoworkSync).not.toHaveBeenCalled()
  })
})
