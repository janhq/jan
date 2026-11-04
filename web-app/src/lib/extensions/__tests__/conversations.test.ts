import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageInfo, PermissionString } from '@janhq/extension-api'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { DefaultMessagesService } from '@/services/messages/default'
import { DefaultThreadsService } from '@/services/threads/default'
import { createConversationsApi } from '../conversations'
import { createContext } from '../context'
import { ContributionStore } from '../contributions'
import { PermissionDispatcher } from '../dispatcher'
import { ExtensionSettingsStore } from '../settings-store'
import { manifest } from './fixtures'
import { memoryAppSettings, memorySecrets } from './memory'

const api = {
  listThreads: vi.fn(),
  createThread: vi.fn(),
  deleteThread: vi.fn(),
  listMessages: vi.fn(),
  createMessage: vi.fn(),
}

const storedThread = {
  id: 't1',
  object: 'thread',
  title: 'First',
  created: 1700000000,
  updated: 1700000500,
  assistants: [],
  metadata: { order: 1 },
}

const storedMessage = (id: string, createdAt: number, text: string) => ({
  id,
  object: 'thread.message',
  thread_id: 't1',
  role: 'user',
  status: 'ready',
  created_at: createdAt,
  completed_at: createdAt,
  content: [
    { type: 'text', text: { value: text, annotations: [] } },
    { type: 'image_url', image_url: { url: 'data:' } },
  ],
})

function setup() {
  const threads = new DefaultThreadsService()
  const messages = new DefaultMessagesService()
  const conversations = createConversationsApi(() => ({
    threads: () => threads,
    messages: () => messages,
  }))
  return { conversations, threads, messages }
}

describe('createConversationsApi', () => {
  const originalCore = window.core

  beforeEach(() => {
    vi.clearAllMocks()
    window.core = { api } as unknown as typeof window.core
    api.listThreads.mockResolvedValue([
      storedThread,
      { ...storedThread, id: TEMPORARY_CHAT_ID, title: 'Temporary Chat' },
    ])
    api.createMessage.mockImplementation(async ({ message }) => message)
    api.deleteThread.mockResolvedValue(undefined)
  })

  afterEach(() => {
    window.core = originalCore
  })

  it('maps threads to public summaries in epoch milliseconds', async () => {
    const { conversations } = setup()
    await expect(conversations.listThreads()).resolves.toEqual([
      { id: 't1', title: 'First', updatedAt: 1700000500000 },
    ])
    await expect(conversations.getThread('t1')).resolves.toEqual({
      id: 't1',
      title: 'First',
      updatedAt: 1700000500000,
      createdAt: 1700000000000,
    })
  })

  it('never exposes the temporary chat', async () => {
    const { conversations } = setup()
    const ids = (await conversations.listThreads()).map((t) => t.id)
    expect(ids).not.toContain(TEMPORARY_CHAT_ID)
    await expect(conversations.getThread(TEMPORARY_CHAT_ID)).resolves.toBe(
      undefined
    )
    await expect(
      conversations.listMessages(TEMPORARY_CHAT_ID)
    ).resolves.toEqual([])
    await expect(
      conversations.appendMessage(TEMPORARY_CHAT_ID, {
        role: 'user',
        text: 'hi',
      })
    ).rejects.toMatchObject({ code: 'E_NOT_FOUND' })
    expect(api.listMessages).not.toHaveBeenCalled()
    expect(api.createMessage).not.toHaveBeenCalled()
  })

  it('maps messages to their concatenated text and honours before/limit', async () => {
    api.listMessages.mockResolvedValue([
      storedMessage('m1', 1700000000000, 'one'),
      storedMessage('m2', 1700000001, 'two'),
      storedMessage('m3', 1700000002000, 'three'),
    ])
    const { conversations } = setup()
    const all = await conversations.listMessages('t1')
    expect(all).toEqual<MessageInfo[]>([
      {
        id: 'm1',
        threadId: 't1',
        role: 'user',
        text: 'one',
        createdAt: 1700000000000,
      },
      {
        id: 'm2',
        threadId: 't1',
        role: 'user',
        text: 'two',
        createdAt: 1700000001000,
      },
      {
        id: 'm3',
        threadId: 't1',
        role: 'user',
        text: 'three',
        createdAt: 1700000002000,
      },
    ])
    const page = await conversations.listMessages('t1', {
      before: 'm3',
      limit: 1,
    })
    expect(page.map((m) => m.id)).toEqual(['m2'])
    await expect(
      conversations.listMessages('t1', { limit: 0 })
    ).rejects.toMatchObject({ code: 'E_INVALID_ARGS' })
  })

  it('creates threads through the threads service', async () => {
    api.createThread.mockImplementation(async ({ thread }) => ({
      ...thread,
      id: 'backend-id',
    }))
    const { conversations } = setup()
    const created = await conversations.createThread({ title: 'New' })
    expect(created).toMatchObject({ id: 'backend-id', title: 'New' })
    expect(api.createThread).toHaveBeenCalledWith({
      thread: expect.objectContaining({ title: 'New' }),
    })
  })

  it('appends a text message to an existing thread', async () => {
    const { conversations } = setup()
    const message = await conversations.appendMessage('t1', {
      role: 'assistant',
      text: 'hello',
    })
    expect(message).toMatchObject({
      threadId: 't1',
      role: 'assistant',
      text: 'hello',
    })
    expect(api.createMessage).toHaveBeenCalledWith({
      message: expect.objectContaining({
        thread_id: 't1',
        role: 'assistant',
        content: [
          { type: 'text', text: { value: 'hello', annotations: [] } },
        ],
      }),
    })
    await expect(
      conversations.appendMessage('missing', { role: 'user', text: 'x' })
    ).rejects.toMatchObject({ code: 'E_NOT_FOUND' })
  })

  it('fires onDidCreateMessage once per created message, whoever created it', async () => {
    const { conversations, messages } = setup()
    const listener = vi.fn()
    const sub = conversations.onDidCreateMessage(listener)

    await messages.createMessage(
      storedMessage('m1', 1700000000000, 'from the app') as never
    )
    await conversations.appendMessage('t1', { role: 'user', text: 'api' })
    await messages.createMessage({
      ...storedMessage('tmp', 1, 'temp'),
      thread_id: TEMPORARY_CHAT_ID,
    } as never)
    api.createMessage.mockRejectedValueOnce(new Error('disk full'))
    await messages.createMessage(
      storedMessage('failed', 1700000000000, 'not persisted') as never
    )

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls[0][0]).toEqual({
      threadId: 't1',
      message: expect.objectContaining({ id: 'm1', text: 'from the app' }),
    })
    sub.dispose()
    await messages.createMessage(
      storedMessage('m9', 1700000000000, 'late') as never
    )
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('fires onDidDeleteThread for persisted threads only', async () => {
    const { conversations, threads } = setup()
    const listener = vi.fn()
    conversations.onDidDeleteThread(listener)
    await threads.deleteThread('t1')
    await threads.deleteThread(TEMPORARY_CHAT_ID)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ threadId: 't1' })
  })

  it('is denied through the context without a conversations grant', async () => {
    const { conversations } = setup()
    const run = (permissions: PermissionString[]) => {
      const m = manifest('acme.reader', { permissions })
      const dispatcher = new PermissionDispatcher()
      dispatcher.grant(m.id, m.permissions)
      return createContext(m, {
        dispatcher,
        contributions: new ContributionStore(),
        settings: new ExtensionSettingsStore({
          appSettings: memoryAppSettings(),
          secrets: memorySecrets(),
        }),
        storage: memoryAppSettings(),
        notify: vi.fn(),
        conversations,
      })
    }
    const denied = run([])
    await expect(denied.conversations.listThreads()).rejects.toMatchObject({
      code: 'E_PERMISSION',
    })
    await expect(
      run(['conversations:read']).conversations.appendMessage('t1', {
        role: 'user',
        text: 'x',
      })
    ).rejects.toMatchObject({ code: 'E_PERMISSION' })
    expect(api.listThreads).not.toHaveBeenCalled()
    expect(api.createMessage).not.toHaveBeenCalled()
    await expect(
      run(['conversations:read']).conversations.listThreads()
    ).resolves.toHaveLength(1)
  })
})
