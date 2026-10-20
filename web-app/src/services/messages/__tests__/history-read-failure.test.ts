import { beforeEach, expect, it, vi } from 'vitest'
import { DefaultMessagesService } from '../default'

const h = vi.hoisted(() => ({ listMessages: vi.fn(), get: vi.fn() }))
vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: h.get }) },
}))

beforeEach(() => {
  vi.resetAllMocks()
  h.get.mockReturnValue({ listMessages: h.listMessages })
})

it('reports a failed history read instead of returning an empty conversation', async () => {
  const error = new Error('history file is locked')
  h.listMessages.mockRejectedValue(error)
  await expect(new DefaultMessagesService().fetchMessages('saved-thread')).rejects.toBe(error)
})

it('reports unavailable persistence instead of returning an empty conversation', async () => {
  h.get.mockReturnValue(undefined)
  await expect(new DefaultMessagesService().fetchMessages('saved-thread'))
    .rejects.toThrow('Conversational extension not available yet')
})
