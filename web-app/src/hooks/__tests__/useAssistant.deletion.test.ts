import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssistant, defaultAssistant } from '../useAssistant'
import { localStorageKey } from '@/constants/localStorage'

const backend = vi.hoisted(() => ({ remove: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ assistants: () => ({ deleteAssistant: backend.remove }) }),
}))
const custom = { ...defaultAssistant, id: 'custom', name: 'Custom' }
const other = { ...defaultAssistant, id: 'other', name: 'Other' }
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
beforeEach(() => {
  backend.remove.mockReset().mockResolvedValue(undefined)
  localStorage.clear()
  localStorage.setItem(localStorageKey.lastUsedAssistant, custom.id)
  localStorage.setItem(localStorageKey.defaultAssistantId, custom.id)
  useAssistant.setState({ assistants: [defaultAssistant, custom, other], currentAssistant: custom, defaultAssistantId: custom.id })
})
describe('assistant deletion persistence', () => {
  it('preserves the list and both selections until deletion succeeds', async () => {
    const save = deferred()
    backend.remove.mockReturnValueOnce(save.promise)
    const pending = Promise.resolve(useAssistant.getState().deleteAssistant(custom.id))
    expect(useAssistant.getState().assistants).toContain(custom)
    expect(useAssistant.getState().currentAssistant).toBe(custom)
    expect(useAssistant.getState().defaultAssistantId).toBe(custom.id)
    save.resolve()
    await pending
    expect(useAssistant.getState().assistants).not.toContain(custom)
    expect(useAssistant.getState().currentAssistant).toBe(defaultAssistant)
    expect(useAssistant.getState().defaultAssistantId).toBe(defaultAssistant.id)
    expect(localStorage.getItem(localStorageKey.lastUsedAssistant)).toBe(defaultAssistant.id)
    expect(localStorage.getItem(localStorageKey.defaultAssistantId)).toBe(defaultAssistant.id)
  })
  it('rejects failed deletion without changing state or stored preferences and allows retry', async () => {
    backend.remove.mockRejectedValueOnce(new Error('file locked'))
    await expect(useAssistant.getState().deleteAssistant(custom.id)).rejects.toThrow('file locked')
    expect(useAssistant.getState().assistants).toContain(custom)
    expect(useAssistant.getState().currentAssistant).toBe(custom)
    expect(useAssistant.getState().defaultAssistantId).toBe(custom.id)
    expect(localStorage.getItem(localStorageKey.lastUsedAssistant)).toBe(custom.id)
    expect(localStorage.getItem(localStorageKey.defaultAssistantId)).toBe(custom.id)
    await useAssistant.getState().deleteAssistant(custom.id)
    expect(useAssistant.getState().assistants).not.toContain(custom)
    expect(backend.remove).toHaveBeenCalledTimes(2)
  })
  it('preserves a selection changed while deletion was pending', async () => {
    const save = deferred()
    backend.remove.mockReturnValueOnce(save.promise)
    const pending = Promise.resolve(useAssistant.getState().deleteAssistant(custom.id))
    useAssistant.getState().setDefaultAssistant(other.id)
    save.resolve()
    await pending
    expect(useAssistant.getState().currentAssistant).toBe(other)
    expect(useAssistant.getState().defaultAssistantId).toBe(other.id)
    expect(localStorage.getItem(localStorageKey.defaultAssistantId)).toBe(other.id)
  })
  it('does not pass an undefined assistant to the backend for an unknown id', async () => {
    await useAssistant.getState().deleteAssistant('missing')
    expect(backend.remove).not.toHaveBeenCalled()
  })
})
