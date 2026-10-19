import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DialogDeleteAllModels } from '../dialogs/DeleteAllModels'

const h = vi.hoisted(() => ({
  removeFavorite: vi.fn(), deleteCache: vi.fn(), setProviders: vi.fn(),
  deleteModel: vi.fn(), stopModel: vi.fn(), getProviders: vi.fn(),
  success: vi.fn(), error: vi.fn(),
}))
vi.mock('@/hooks/useFavoriteModel', () => ({ useFavoriteModel: () => ({ removeFavorite: h.removeFavorite }) }))
vi.mock('@/hooks/useModelProvider', () => ({ useModelProvider: () => ({ deleteModel: h.deleteCache, setProviders: h.setProviders }) }))
vi.mock('@/hooks/useAppState', () => ({ useAppState: () => [[]] }))
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => ({
  models: () => ({ deleteModel: h.deleteModel, stopModel: h.stopModel, fetchModels: async () => [] }),
  providers: () => ({ getProviders: h.getProviders }),
}) }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { success: h.success, error: h.error } }))
vi.mock('@/lib/utils', () => ({ formatBytes: () => '0', cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogClose: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const provider = { provider: 'llamacpp', active: true, settings: [], models: [
  { id: 'deleted' }, { id: 'locked' }, { id: 'external', imported: true },
] }

describe('bulk deletion failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getProviders.mockResolvedValue([provider])
  })

  it('only removes confirmed deletions from the cache, favorites and refreshed list', async () => {
    h.deleteModel.mockImplementation(async (id: string) => {
      if (id === 'locked') throw new Error('file locked')
    })
    render(<DialogDeleteAllModels provider={provider} />)
    fireEvent.click(screen.getByText('providers:deleteAllModels.confirm'))
    await waitFor(() => expect(h.setProviders).toHaveBeenCalled())
    expect(h.deleteCache.mock.calls).toEqual([['deleted']])
    expect(h.removeFavorite.mock.calls.map(([id]) => id)).toEqual(['deleted'])
    expect(h.setProviders.mock.calls[0][0][0].models.map((m: Model) => m.id)).toEqual(['locked', 'external'])
    expect(h.deleteModel.mock.calls.map(([id]) => id)).toEqual(['deleted', 'locked'])
    expect(h.error).toHaveBeenCalled()
  })

  it('keeps pending deletions visible until the filesystem confirms success', async () => {
    let finish!: () => void
    h.deleteModel.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    h.deleteModel.mockResolvedValue(undefined)
    render(<DialogDeleteAllModels provider={provider} />)
    fireEvent.click(screen.getByText('providers:deleteAllModels.confirm'))
    expect(h.deleteCache).not.toHaveBeenCalled()
    expect(h.removeFavorite).not.toHaveBeenCalled()
    finish()
    await waitFor(() => expect(h.setProviders).toHaveBeenCalled())
    expect(h.deleteCache.mock.calls).toEqual([['deleted'], ['locked']])
  })
})
