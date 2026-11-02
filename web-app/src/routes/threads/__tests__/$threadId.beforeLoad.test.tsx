/**
 * Consumption regressions for the /threads/$threadId beforeLoad guard
 * (integrated persistence review R2/R3). These exercise the REAL Route
 * options with the REAL zustand stores — only the component tree around the
 * route is mocked — so they fail if the route stops consuming
 * shouldRedirectThreadToCowork.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  redirect: (r: unknown) => Object.assign(new Error('redirect'), { redirect: r }),
  useParams: () => ({}),
  useSearch: () => ({}),
  Link: () => null,
}))

// The route module imports the full chat component tree; stub the heavy
// containers/hooks so importing the Route stays cheap. None of these are
// exercised: only `beforeLoad` runs.
vi.mock('@/containers/HeaderPage', () => ({ default: () => null }))
vi.mock('@/containers/ChatInput', () => ({ default: () => null }))
vi.mock('@/containers/MessageItem', () => ({ MessageItem: () => null }))
vi.mock('@/containers/ConversationHeaderTitle', () => ({
  ConversationHeaderTitle: () => null,
}))
vi.mock('@/hooks/use-chat', () => ({ useChat: vi.fn() }))
vi.mock('@/hooks/useChatShell', () => ({ useChatShell: vi.fn() }))
vi.mock('@/lib/extension', () => ({ ExtensionManager: { getInstance: vi.fn() } }))
vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({ engineSlotsIdle: vi.fn() }))
vi.mock('@/lib/agentTools', () => ({
  CHAT_AGENT_TOOL_NAMES: [],
  executeAgentTool: vi.fn(),
}))
vi.mock('@/lib/webSearchTool', () => ({
  webToolRoute: vi.fn(),
  executeWebTool: vi.fn(),
}))

// beforeLoad falls back to a direct backend lookup when the threads store has
// no record (R3 hydration race). Default to "backend ready, no threads" so the
// pre-existing guard tests (which exercise store-seeded paths or unknown ids)
// keep passing; individual tests override per-case.
const fetchThreadsMock = vi.fn<() => Promise<unknown[]>>(() =>
  Promise.resolve([])
)
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ threads: () => ({ fetchThreads: fetchThreadsMock }) }),
  useServiceHub: vi.fn(),
}))

import { Route } from '../$threadId'
import { useCoworkSessions, type CoworkSession } from '@/hooks/useCoworkSessions'
import { useThreads } from '@/hooks/useThreads'
import type { Thread } from '@janhq/core'

type RouteOpts = {
  beforeLoad: (a: { params: { threadId: string } }) => void | Promise<void>
}

const runBeforeLoad = async (threadId: string) => {
  try {
    await (Route as unknown as RouteOpts).beforeLoad({ params: { threadId } })
    return null
  } catch (e) {
    return (e as { redirect: { to: string; params?: unknown; replace?: boolean } }).redirect
  }
}

const session = (
  id: string,
  unavailable?: CoworkSession['unavailable']
): CoworkSession =>
  ({
    id,
    title: id,
    folder: null,
    turns: [],
    messages: [],
    updated: 1,
    ...(unavailable ? { unavailable } : {}),
  }) as CoworkSession

const seedSessions = (sessions: CoworkSession[]) =>
  useCoworkSessions.setState({ sessions, currentId: null })

const seedThread = (id: string, metadata: Record<string, unknown> | undefined) =>
  useThreads.setState({
    threads: {
      [id]: {
        id,
        title: id,
        metadata,
        assistants: [],
      } as unknown as Thread,
    },
  })

describe('/threads/$threadId beforeLoad guard (R2/R3 consumption)', () => {
  beforeEach(() => {
    seedSessions([])
    useThreads.setState({ threads: {} })
    fetchThreadsMock.mockClear()
    fetchThreadsMock.mockImplementation(() => Promise.resolve([]))
  })

  it('R2: an id-collision placeholder does NOT steal the route from the real chat', async () => {
    seedThread('shared-id', {})
    seedSessions([session('shared-id', 'id-collision')])
    expect(await runBeforeLoad('shared-id')).toBeNull()
  })

  it('a normal cowork session still redirects to /cowork/$sessionId', async () => {
    seedSessions([session('cw-1')])
    expect(await runBeforeLoad('cw-1')).toMatchObject({
      to: '/cowork/$sessionId',
      params: { sessionId: 'cw-1' },
      replace: true,
    })
  })

  it('unavailable placeholders other than id-collision keep redirecting (read-only Cowork view)', async () => {
    seedSessions([
      session('cw-missing', 'missing-sidecar'),
      session('cw-unreadable', 'unreadable-sidecar'),
    ])
    expect(await runBeforeLoad('cw-missing')).toMatchObject({
      to: '/cowork/$sessionId',
      params: { sessionId: 'cw-missing' },
    })
    expect(await runBeforeLoad('cw-unreadable')).toMatchObject({
      to: '/cowork/$sessionId',
      params: { sessionId: 'cw-unreadable' },
    })
  })

  it('R3: a cowork-mode thread redirects even with an EMPTY session store (no chat fork)', async () => {
    seedThread('cw-orphan', { mode: 'cowork' })
    expect(useCoworkSessions.getState().sessions).toHaveLength(0)
    expect(await runBeforeLoad('cw-orphan')).toMatchObject({
      to: '/cowork/$sessionId',
      params: { sessionId: 'cw-orphan' },
      replace: true,
    })
  })

  it('an ordinary chat thread with no session never redirects', async () => {
    seedThread('chat-1', {})
    expect(await runBeforeLoad('chat-1')).toBeNull()
    // unknown id entirely
    expect(await runBeforeLoad('unknown-id')).toBeNull()
  })

  it('R3 hydration race: BOTH stores empty, persisted cowork thread fetched from backend redirects', async () => {
    fetchThreadsMock.mockImplementation(() =>
      Promise.resolve([
        { id: 'cw-hydrating', title: 'cw', metadata: { mode: 'cowork' } },
      ])
    )
    expect(useCoworkSessions.getState().sessions).toHaveLength(0)
    expect(useThreads.getState().threads['cw-hydrating']).toBeUndefined()
    expect(await runBeforeLoad('cw-hydrating')).toMatchObject({
      to: '/cowork/$sessionId',
      params: { sessionId: 'cw-hydrating' },
      replace: true,
    })
    expect(fetchThreadsMock).toHaveBeenCalledTimes(1)
    // The fetched list is NOT written back: a stale fetch must never
    // overwrite a newer store hydration.
    expect(useThreads.getState().threads['cw-hydrating']).toBeUndefined()
  })

  it('R3 hydration race: a fetched ordinary chat thread mounts chat normally (no redirect)', async () => {
    fetchThreadsMock.mockImplementation(() =>
      Promise.resolve([{ id: 'chat-hydrating', title: 'chat', metadata: {} }])
    )
    expect(await runBeforeLoad('chat-hydrating')).toBeNull()
    expect(fetchThreadsMock).toHaveBeenCalledTimes(1)
    expect(useThreads.getState().threads['chat-hydrating']).toBeUndefined()
  })

  it('R3 stale-fetch race: a store record landing DURING the fetch wins over the stale backend snapshot', async () => {
    // The cowork commit (or a hydration) finishes while the deferred backend
    // lookup is in flight: the fetch was issued before the write completed, so
    // the backend snapshot resolves EMPTY. The post-await decision must re-read
    // the store — code that only consults `fetched.find(...)` classifies the
    // just-committed cowork thread as an ordinary chat and mounts a writable
    // chat view over it.
    fetchThreadsMock.mockImplementation(async () => {
      // Simulate the mid-await store write, then resolve the stale (pre-write)
      // backend snapshot.
      seedThread('cw-racing', { mode: 'cowork' })
      return []
    })
    expect(useThreads.getState().threads['cw-racing']).toBeUndefined()
    expect(await runBeforeLoad('cw-racing')).toMatchObject({
      to: '/cowork/$sessionId',
      params: { sessionId: 'cw-racing' },
      replace: true,
    })
    expect(fetchThreadsMock).toHaveBeenCalledTimes(1)
    // beforeLoad itself still never writes the fetched list back globally —
    // only the externally-landed record is present.
    expect(Object.keys(useThreads.getState().threads)).toEqual(['cw-racing'])
  })

  it('a rejected backend lookup propagates as a route error so no writable chat mounts', async () => {
    fetchThreadsMock.mockImplementation(() =>
      Promise.reject(new Error('Conversational extension not available yet'))
    )
    await expect(
      (Route as unknown as RouteOpts).beforeLoad({
        params: { threadId: 'cw-undecidable' },
      })
    ).rejects.toThrow('Conversational extension not available yet')
  })

  it('an id unknown to the backend too keeps the existing unknown-thread behavior', async () => {
    // fetchThreads resolves [] (default): not found anywhere → no redirect,
    // same as the pre-existing unknown-id path.
    expect(await runBeforeLoad('nowhere-id')).toBeNull()
    expect(fetchThreadsMock).toHaveBeenCalled()
  })

  it('the temporary chat id never triggers a backend fetch', async () => {
    expect(await runBeforeLoad('temporary-chat')).toBeNull()
    expect(fetchThreadsMock).not.toHaveBeenCalled()
  })

  it('a store-resident thread never triggers a backend fetch', async () => {
    seedThread('chat-1', {})
    expect(await runBeforeLoad('chat-1')).toBeNull()
    expect(fetchThreadsMock).not.toHaveBeenCalled()
  })
})
