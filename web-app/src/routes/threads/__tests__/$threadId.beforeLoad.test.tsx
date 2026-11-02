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

import { Route } from '../$threadId'
import { useCoworkSessions, type CoworkSession } from '@/hooks/useCoworkSessions'
import { useThreads } from '@/hooks/useThreads'
import type { Thread } from '@janhq/core'

type RouteOpts = { beforeLoad: (a: { params: { threadId: string } }) => void }

const runBeforeLoad = (threadId: string) => {
  try {
    ;(Route as unknown as RouteOpts).beforeLoad({ params: { threadId } })
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
  })

  it('R2: an id-collision placeholder does NOT steal the route from the real chat', () => {
    seedThread('shared-id', {})
    seedSessions([session('shared-id', 'id-collision')])
    expect(runBeforeLoad('shared-id')).toBeNull()
  })

  it('a normal cowork session still redirects to /cowork/$sessionId', () => {
    seedSessions([session('cw-1')])
    expect(runBeforeLoad('cw-1')).toMatchObject({
      to: '/cowork/$sessionId',
      params: { sessionId: 'cw-1' },
      replace: true,
    })
  })

  it('unavailable placeholders other than id-collision keep redirecting (read-only Cowork view)', () => {
    seedSessions([
      session('cw-missing', 'missing-sidecar'),
      session('cw-unreadable', 'unreadable-sidecar'),
    ])
    expect(runBeforeLoad('cw-missing')).toMatchObject({
      to: '/cowork/$sessionId',
      params: { sessionId: 'cw-missing' },
    })
    expect(runBeforeLoad('cw-unreadable')).toMatchObject({
      to: '/cowork/$sessionId',
      params: { sessionId: 'cw-unreadable' },
    })
  })

  it('R3: a cowork-mode thread redirects even with an EMPTY session store (no chat fork)', () => {
    seedThread('cw-orphan', { mode: 'cowork' })
    expect(useCoworkSessions.getState().sessions).toHaveLength(0)
    expect(runBeforeLoad('cw-orphan')).toMatchObject({
      to: '/cowork/$sessionId',
      params: { sessionId: 'cw-orphan' },
      replace: true,
    })
  })

  it('an ordinary chat thread with no session never redirects', () => {
    seedThread('chat-1', {})
    expect(runBeforeLoad('chat-1')).toBeNull()
    // unknown id entirely
    expect(runBeforeLoad('unknown-id')).toBeNull()
  })
})
