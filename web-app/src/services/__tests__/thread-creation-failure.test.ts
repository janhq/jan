import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DefaultThreadsService } from '../threads/default'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

const { createThread, getExtension } = vi.hoisted(() => ({
  createThread: vi.fn(),
  getExtension: vi.fn(),
}))
vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: getExtension }) },
}))

describe('thread creation persistence failures', () => {
  const service = new DefaultThreadsService()
  const draft = {
    id: 'draft', title: 'Keep my prompt', updated: 1,
    model: { id: 'model', provider: 'openai' }, assistants: [],
  } as Thread

  beforeEach(() => {
    vi.resetAllMocks()
    getExtension.mockReturnValue({ createThread })
  })

  it('rejects a failed disk write instead of returning an unsaved thread', async () => {
    const failure = new Error('disk full')
    createThread.mockRejectedValue(failure)
    await expect(service.createThread(draft)).rejects.toBe(failure)
  })

  it('rejects when persistence is not ready', async () => {
    getExtension.mockReturnValue(undefined)
    await expect(service.createThread(draft)).rejects.toThrow('Conversational extension not available yet')
  })

  it('still allows temporary conversations without persistence', async () => {
    getExtension.mockReturnValue(undefined)
    const temporary = { ...draft, id: TEMPORARY_CHAT_ID }
    await expect(service.createThread(temporary)).resolves.toBe(temporary)
    expect(createThread).not.toHaveBeenCalled()
  })
})
