import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  threads: {} as Record<string, unknown>,
  sessions: [] as unknown[],
  messages: {} as Record<string, unknown[]>,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => h.navigate,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}:${o.count}` : k) }),
}))
vi.mock('@/containers/HeaderPage', () => ({ default: () => null }))
vi.mock('@/containers/CoworkArtifactCard', () => ({
  CoworkArtifactCard: ({ artifact, onPreview }: any) => (
    <button onClick={onPreview}>{artifact.title}</button>
  ),
}))
vi.mock('@/hooks/useCoworkSessions', () => ({
  useCoworkSessions: Object.assign((sel: any) => sel({ sessions: h.sessions }), {
    getState: () => ({ selectSession: vi.fn() }),
  }),
}))
vi.mock('@/hooks/useCoworkRun', () => ({ useCoworkRun: { getState: () => ({ requestPreview: vi.fn() }) } }))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: (sel: any) => sel({ threads: h.threads }),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    app: () => ({ getJanDataFolder: async () => '/data' }),
    messages: () => ({ fetchMessages: async (id: string) => h.messages[id] ?? [] }),
  }),
}))
vi.mock('@janhq/tauri-plugin-agent-tools-api', () => ({
  sessionWorkspacePath: async (_d: string, id: string) => `/data/sessions/${id}`,
  threadWorkspacePath: async (_d: string, id: string) => `/data/threads/${id}`,
}))

import { Route } from '../artifacts'

const Page = (Route as any).options.component

// The persisted shape: a tool call is a `tool_call` content item carrying its output.
const writeMessage = (path: string) => ({
  id: 'm1',
  object: 'thread.message',
  thread_id: 't1',
  role: 'assistant',
  status: 'ready',
  created_at: 1,
  completed_at: 1,
  content: [
    { type: 'text', text: { value: 'done', annotations: [] } },
    { type: 'tool_call', tool_call_id: 'w1', tool_name: 'write', input: { path }, output: `Created ${path} (2 bytes)` },
  ],
})

beforeEach(() => {
  h.navigate.mockClear()
  h.threads = {}
  h.sessions = []
  h.messages = {}
})
afterEach(cleanup)

describe('Artifacts page', () => {
  it('is not gated to builds that ship the Cowork surface', () => {
    expect((Route as any).options.beforeLoad).toBeUndefined()
  })

  it('lists artifacts of unified threads and opens the thread', async () => {
    h.threads = { t1: { id: 't1', title: 'Make a page', updated: 10, metadata: {} } }
    h.messages = { t1: [writeMessage('page.html')] }
    render(<Page />)
    const card = await screen.findByText('page')
    fireEvent.click(card)
    expect(h.navigate).toHaveBeenCalledWith({ to: '/threads/$threadId', params: { threadId: 't1' } })
  })

  it('lists legacy Cowork sessions on every channel', async () => {
    h.sessions = [
      {
        id: 's1', title: 'Old session', updated: 5, folder: null,
        turns: [{ role: 'tool', name: 'write', args: { path: 'old.html' }, result: 'Created old.html (2 bytes)' }],
      },
    ]
    render(<Page />)
    expect(await screen.findByText('old')).toBeInTheDocument()
  })
})
