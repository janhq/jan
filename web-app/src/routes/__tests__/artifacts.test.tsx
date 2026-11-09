import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  select: vi.fn(),
  preview: vi.fn(),
  sessions: [] as unknown[],
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => h.navigate,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) =>
      o?.count !== undefined ? `${k}:${o.count}` : k,
  }),
}))
vi.mock('@/containers/HeaderPage', () => ({ default: () => null }))
vi.mock('@/containers/CoworkArtifactCard', () => ({
  CoworkArtifactCard: ({
    artifact,
    onPreview,
  }: {
    artifact: { title: string }
    onPreview: () => void
  }) => <button onClick={onPreview}>{artifact.title}</button>,
}))
vi.mock('@/hooks/useCoworkSessions', () => ({
  useCoworkSessions: Object.assign(
    (sel: (s: { sessions: unknown[] }) => unknown) =>
      sel({ sessions: h.sessions }),
    { getState: () => ({ selectSession: h.select }) }
  ),
}))
vi.mock('@/hooks/useCoworkRun', () => ({
  useCoworkRun: { getState: () => ({ requestPreview: h.preview }) },
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ app: () => ({ getJanDataFolder: async () => '/data' }) }),
}))
vi.mock('@janhq/tauri-plugin-agent-tools-api', () => ({
  threadWorkspacePath: async (_d: string, id: string) => `/data/threads/${id}`,
}))

import { Route } from '../artifacts'

const Page = (Route as unknown as { options: { component: () => JSX.Element } })
  .options.component

beforeEach(() => {
  h.navigate.mockClear()
  h.select.mockClear()
  h.preview.mockClear()
  h.sessions = [
    {
      id: 's1',
      title: 'Old session',
      updated: 5,
      folder: null,
      turns: [
        {
          role: 'tool',
          name: 'write',
          args: { path: 'old.html' },
          result: 'Created old.html (2 bytes)',
        },
      ],
    },
  ]
})
afterEach(cleanup)

describe('Artifacts page', () => {
  it('is not gated to builds that ship the Cowork surface', () => {
    expect(
      (Route as unknown as { options: { beforeLoad?: unknown } }).options
        .beforeLoad
    ).toBeUndefined()
  })

  it('opens the artifact in its conversation URL, not the bare /cowork', async () => {
    render(<Page />)
    fireEvent.click(await screen.findByText('old'))
    expect(h.select).toHaveBeenCalledWith('s1')
    expect(h.preview).toHaveBeenCalledWith('s1', expect.stringContaining('old.html'))
    expect(h.navigate).toHaveBeenCalledWith({
      to: '/cowork/$sessionId',
      params: { sessionId: 's1' },
    })
  })
})
