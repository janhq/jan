import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const navigation = vi.hoisted(() => ({
  pathname: '/threads/chat-a',
  threads: {} as Record<string, { id: string }>,
  running: {} as Record<string, string>,
}))
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: navigation.pathname }),
  Link: ({
    to,
    onClick,
    children,
    ...props
  }: {
    to: string
    onClick?: () => void
    children: ReactNode
  }) => (
    <a
      {...props}
      href={to}
      onClick={(event) => {
        event.preventDefault()
        onClick?.()
        navigation.pathname = to
      }}
    >
      {children}
    </a>
  ),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: (
    selector: (state: { threads: typeof navigation.threads }) => unknown
  ) => selector({ threads: navigation.threads }),
}))
vi.mock('@/hooks/useCoworkRun', () => ({
  useCoworkRun: { getState: () => ({ runId: navigation.running }) },
}))
vi.mock('@/lib/backendStorage', () => ({
  backendStorage: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}))

import { NavTabs } from '../NavTabs'
import { startNewSession, useCoworkSessions } from '../../../hooks/useCoworkSessions'

beforeEach(() => {
  navigation.pathname = '/threads/chat-a'
  navigation.threads = { 'chat-a': { id: 'chat-a' } }
  navigation.running = {}
  useCoworkSessions.setState({ sessions: [], currentId: null })
})

function tabs() {
  const view = render(<NavTabs surfacePath={navigation.pathname} />)
  const refresh = () =>
    view.rerender(<NavTabs surfacePath={navigation.pathname} />)
  return {
    visit: (pathname: string) => {
      navigation.pathname = pathname
      refresh()
    },
    click: (tab: 'home' | 'cowork') => {
      fireEvent.click(screen.getByRole('link', { name: `common:${tab}` }))
      refresh()
    },
  }
}

it('returns to the previously viewed chat and Cowork conversation in both directions', () => {
  const store = useCoworkSessions.getState()
  const session = store.createSession()
  store.commitTurns(
    session,
    [{ role: 'user', content: 'Remember this conversation' }],
    [],
    []
  )
  const view = tabs()
  view.click('cowork')
  expect(useCoworkSessions.getState().currentId).toBe(session)
  view.click('home')
  expect(navigation.pathname).toBe('/threads/chat-a')
  view.click('cowork')
  expect(useCoworkSessions.getState().currentId).toBe(session)
  expect(useCoworkSessions.getState().sessions).toHaveLength(1)
})

it('restores chat independently of Cowork selection', () => {
  const view = tabs()
  view.click('cowork')
  view.click('home')
  expect(navigation.pathname).toBe('/threads/chat-a')
})

it('keeps an explicitly opened blank chat instead of restoring an older thread', () => {
  const view = tabs()
  view.visit('/')
  view.click('cowork')
  view.click('home')
  expect(navigation.pathname).toBe('/')
})

it('falls back to a blank chat if the remembered thread was deleted', () => {
  const view = tabs()
  view.click('cowork')
  navigation.threads = {}
  view.visit('/cowork')
  view.click('home')
  expect(navigation.pathname).toBe('/')
})

it('opens blank chat when Cowork was the first surface visited', () => {
  navigation.pathname = '/cowork'
  const view = tabs()
  view.click('home')
  expect(navigation.pathname).toBe('/')
})

it('keeps the first streaming Cowork session when switching or clicking the active tab', () => {
  const session = useCoworkSessions.getState().createSession()
  navigation.running = { [session]: 'active-run' }
  const view = tabs()
  view.click('cowork')
  expect(useCoworkSessions.getState().currentId).toBe(session)
  view.click('cowork')
  expect(useCoworkSessions.getState().currentId).toBe(session)
})

it('retains an explicit new Cowork session and the existing deletion fallback', () => {
  const store = useCoworkSessions.getState()
  const previous = store.createSession()
  store.commitTurns(
    previous,
    [{ role: 'user', content: 'Existing conversation' }],
    [],
    []
  )
  const fresh = startNewSession([])
  const view = tabs()
  view.click('cowork')
  expect(useCoworkSessions.getState().currentId).toBe(fresh)
  view.click('home')
  store.deleteSession(fresh)
  view.click('cowork')
  expect(useCoworkSessions.getState().currentId).toBe(previous)
})
