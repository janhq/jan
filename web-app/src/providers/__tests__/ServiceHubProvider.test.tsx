import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  order: [] as string[],
  initializeServiceHub: vi.fn(),
  migrateLocalStorageToBackend: vi.fn(),
  hydrateBackendStores: vi.fn(),
  migrateCoworkSessionsOnStartup: vi.fn(),
  refreshThreadsFromBackend: vi.fn(),
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

vi.mock('@/lib/refreshThreads', () => ({
  refreshThreadsFromBackend: h.refreshThreadsFromBackend,
}))

import {
  ServiceHubProvider,
  COWORK_MIGRATION_BUDGET_MS,
} from '../ServiceHubProvider'

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
    h.refreshThreadsFromBackend.mockReset().mockResolvedValue(undefined)
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

  describe('a slow Cowork migration', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    const result = (migrated: string[]) => ({
      status: 'complete' as const,
      migrated,
      skipped: [],
      abandoned: [],
      failed: [],
    })

    const deferred = () => {
      let resolve: (r: ReturnType<typeof result>) => void = () => {}
      let reject: (e: Error) => void = () => {}
      const promise = new Promise<ReturnType<typeof result>>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }

    const mountSlow = () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const d = deferred()
      h.migrateCoworkSessionsOnStartup.mockReturnValue(d.promise)
      render(
        <ServiceHubProvider>
          <div data-testid="child" />
        </ServiceHubProvider>
      )
      return d
    }

    it('does not hold the app past its budget, then refreshes the thread list when it finishes', async () => {
      const d = mountSlow()
      expect(screen.queryByTestId('child')).toBeNull()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COWORK_MIGRATION_BUDGET_MS + 50)
      })
      expect(screen.getByTestId('child')).toBeTruthy()
      expect(h.refreshThreadsFromBackend).not.toHaveBeenCalled()

      await act(async () => {
        d.resolve(result(['s1']))
      })
      await waitFor(() =>
        expect(h.refreshThreadsFromBackend).toHaveBeenCalledTimes(1)
      )
    })

    it('does not refresh when the late migration copied nothing', async () => {
      const d = mountSlow()
      await vi.advanceTimersByTimeAsync(COWORK_MIGRATION_BUDGET_MS + 50)
      await act(async () => {
        d.resolve(result([]))
      })
      expect(h.refreshThreadsFromBackend).not.toHaveBeenCalled()
    })

    it('a late rejection stays non-throwing', async () => {
      const d = mountSlow()
      await vi.advanceTimersByTimeAsync(COWORK_MIGRATION_BUDGET_MS + 50)
      await act(async () => {
        d.reject(new Error('late boom'))
      })
      expect(screen.getByTestId('child')).toBeTruthy()
      expect(h.refreshThreadsFromBackend).not.toHaveBeenCalled()
    })

    it('a failing refresh stays non-throwing', async () => {
      h.refreshThreadsFromBackend.mockRejectedValue(new Error('refresh boom'))
      const d = mountSlow()
      await vi.advanceTimersByTimeAsync(COWORK_MIGRATION_BUDGET_MS + 50)
      await act(async () => {
        d.resolve(result(['s1']))
      })
      expect(screen.getByTestId('child')).toBeTruthy()
    })

    it('a migration that finishes inside the budget needs no refresh', async () => {
      h.migrateCoworkSessionsOnStartup.mockResolvedValue(result(['s1']))
      render(
        <ServiceHubProvider>
          <div data-testid="child" />
        </ServiceHubProvider>
      )
      await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy())
      expect(h.refreshThreadsFromBackend).not.toHaveBeenCalled()
    })
  })
})
