import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  redirect: (r: unknown) => Object.assign(new Error('redirect'), { redirect: r }),
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
}))
vi.mock('@/containers/CoworkPage', () => ({ CoworkPage: () => null }))

import { useCoworkSessions } from '@/hooks/useCoworkSessions'

type Opts = { beforeLoad: (a: { params?: Record<string, string> }) => void }
const run = (o: Opts, params?: Record<string, string>) => {
  try {
    o.beforeLoad({ params })
    return null
  } catch (e) {
    return (e as { redirect: { to: string; params?: unknown } }).redirect
  }
}

const seed = (ids: string[], currentId: string | null) =>
  useCoworkSessions.setState({
    sessions: ids.map((id) => ({
      id,
      title: id,
      folder: null,
      turns: [{ role: 'user', content: 'x' }],
      messages: [],
      updated: 1,
    })),
    currentId,
  })

describe('/cowork', () => {
  beforeEach(() => {
    seed([], null)
  })

  it('forwards to the current session', async () => {
    const { Route } = (await import('../cowork/index')) as unknown as { Route: Opts }
    seed(['a', 'b'], 'b')
    expect(run(Route)).toMatchObject({
      to: '/cowork/$sessionId',
      params: { sessionId: 'b' },
    })
  })

  it('goes home when there is no current session, without creating one', async () => {
    const { Route } = (await import('../cowork/index')) as unknown as { Route: Opts }
    expect(run(Route)).toMatchObject({ to: '/' })
    expect(useCoworkSessions.getState().sessions).toHaveLength(0)
  })
})

describe('/cowork/$sessionId', () => {
  beforeEach(() => {
    seed([], null)
  })

  it('opens a known session', async () => {
    const { Route } = (await import('../cowork/$sessionId')) as unknown as { Route: Opts }
    seed(['a'], null)
    expect(run(Route, { sessionId: 'a' })).toBeNull()
  })

  it('sends an untouched session to unified home', async () => {
    const { Route } = (await import('../cowork/$sessionId')) as unknown as { Route: Opts }
    useCoworkSessions.setState({
      sessions: [{ id: 'blank', title: 'blank', folder: null, turns: [], messages: [], updated: 1 }],
      currentId: null,
    })
    expect(run(Route, { sessionId: 'blank' })).toMatchObject({ to: '/' })
    expect(useCoworkSessions.getState().sessions).toHaveLength(1)
  })

  it('redirects an unknown id home', async () => {
    const { Route } = (await import('../cowork/$sessionId')) as unknown as { Route: Opts }
    seed(['a'], null)
    expect(run(Route, { sessionId: 'nope' })).toMatchObject({ to: '/' })
  })
})
