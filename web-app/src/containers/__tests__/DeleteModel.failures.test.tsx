import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DialogDeleteModel } from '../dialogs/DeleteModel'

const h = vi.hoisted(() => ({
  removeFavorite: vi.fn(), deleteCache: vi.fn(), setProviders: vi.fn(),
  deleteModel: vi.fn(), getProviders: vi.fn(), success: vi.fn(), error: vi.fn(),
}))
vi.mock('@/hooks/useFavoriteModel', () => ({ useFavoriteModel: () => ({ removeFavorite: h.removeFavorite }) }))
vi.mock('@/hooks/useModelProvider', () => ({ useModelProvider: () => ({ deleteModel: h.deleteCache, setProviders: h.setProviders }) }))
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => ({
  models: () => ({ deleteModel: h.deleteModel }), providers: () => ({ getProviders: h.getProviders }),
}) }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { success: h.success, error: h.error } }))
vi.mock('@/components/ui/tooltip', () => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => <div>{children}</div>
  return { Tooltip: Wrapper, TooltipContent: Wrapper, TooltipTrigger: Wrapper }
})
vi.mock('@/components/ui/dialog', () => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => <div>{children}</div>
  return { Dialog: Wrapper, DialogClose: Wrapper, DialogContent: Wrapper, DialogHeader: Wrapper,
    DialogTitle: Wrapper, DialogDescription: Wrapper, DialogFooter: Wrapper, DialogTrigger: Wrapper }
})
const provider = { provider: 'alpha', active: true, settings: [], models: [{ id: 'same' }] }
const confirm = () => screen.getAllByRole('button', { name: 'providers:deleteModel.delete' }).find((element) => element.tagName === 'BUTTON')!

describe('individual model deletion', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    h.getProviders.mockResolvedValue([provider, { ...provider, provider: 'beta' }])
  })

  it('keeps pending models and favorites intact and prevents duplicate submissions', async () => {
    let finish!: () => void
    h.deleteModel.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    render(<DialogDeleteModel provider={provider} modelId="same" />)
    fireEvent.click(confirm())
    expect(h.deleteCache).not.toHaveBeenCalled()
    expect(h.removeFavorite).not.toHaveBeenCalled()
    fireEvent.click(confirm())
    expect(h.deleteModel).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(h.success).toHaveBeenCalled())
  })

  it('reports a deletion failure and allows retry without losing the model', async () => {
    h.deleteModel.mockRejectedValueOnce(new Error('file locked')).mockResolvedValue(undefined)
    render(<DialogDeleteModel provider={provider} modelId="same" />)
    fireEvent.click(confirm())
    await waitFor(() => expect(h.error).toHaveBeenCalled())
    expect(h.deleteCache).not.toHaveBeenCalled()
    expect(h.removeFavorite).not.toHaveBeenCalled()
    expect(h.success).not.toHaveBeenCalled()
    fireEvent.click(confirm())
    await waitFor(() => expect(h.success).toHaveBeenCalled())
    expect(h.deleteModel).toHaveBeenCalledTimes(2)
  })

  it('only filters the owning provider after successful deletion', async () => {
    h.deleteModel.mockResolvedValue(undefined)
    render(<DialogDeleteModel provider={provider} modelId="same" />)
    fireEvent.click(confirm())
    await waitFor(() => expect(h.setProviders).toHaveBeenCalled())
    const refreshed = h.setProviders.mock.calls[0][0]
    expect(refreshed[0].models).toEqual([])
    expect(refreshed[1].models).toEqual([{ id: 'same' }])
  })

  it('contains a refresh failure after the disk operation succeeds', async () => {
    h.deleteModel.mockResolvedValue(undefined)
    h.getProviders.mockRejectedValue(new Error('catalog unavailable'))
    render(<DialogDeleteModel provider={provider} modelId="same" />)
    fireEvent.click(confirm())
    await waitFor(() => expect(h.success).toHaveBeenCalled())
    expect(h.deleteCache.mock.calls.map(([id]) => id)).toEqual(['same'])
    expect(h.error).not.toHaveBeenCalled()
  })
})
