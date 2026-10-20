import { expect, it, vi } from 'vitest'
import type { Thread as StoredThread } from '@janhq/core'
import { DefaultThreadsService } from '../threads/default'

const backend = vi.hoisted(() => ({ saved: null as StoredThread | null }))
vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      get: () => ({
        modifyThread: async (thread: StoredThread) => {
          backend.saved = structuredClone(thread)
        },
        listThreads: async () => (backend.saved ? [backend.saved] : []),
      }),
    }),
  },
}))

it.each([[], undefined])('retains selected model when assistants are %j after reloading', async (assistants) => {
  const service = new DefaultThreadsService()
  const selected = { id: 'gpt-4', provider: 'openai' }
  await service.updateThread({
    id: 'test-thread',
    title: 'Existing chat',
    updated: 1,
    model: selected,
    assistants,
  })
  const [reloaded] = await service.fetchThreads()
  expect(reloaded.model).toEqual(selected)
  expect(reloaded.assistants).toEqual([
    { id: 'model-only', name: 'Model', model: { id: 'gpt-4', engine: 'openai' } },
  ])
})
