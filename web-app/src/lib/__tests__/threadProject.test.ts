import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateThread = vi.fn()
const setThreads = vi.fn()
const state = vi.hoisted(() => ({ threads: {} as Record<string, unknown> }))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: {
    getState: () => ({ threads: state.threads, updateThread, setThreads }),
  },
}))

import { updateThreadProject } from '../threadProject'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'

const project = { id: 'p', name: 'P', updated_at: 1 }
const session = (id: string, extra = {}) =>
  ({ id, title: id, folder: null, turns: [], messages: [], updated: 1, ...extra }) as never

describe('updateThreadProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.threads = {}
    useCoworkSessions.setState({ sessions: [] })
  })

  it('updates a chat thread through the thread list', () => {
    state.threads = { t: { id: 't', metadata: { a: 1 } } }
    updateThreadProject('t', project)
    expect(updateThread).toHaveBeenCalledWith('t', { metadata: { a: 1, project } })
  })

  it('persists a Cowork conversation from its session and updates the mirror', () => {
    state.threads = { c: { id: 'c', metadata: { mode: 'cowork' } } }
    useCoworkSessions.setState({ sessions: [session('c')] })
    updateThreadProject('c', project)
    expect(useCoworkSessions.getState().sessions[0].project).toEqual(project)
    expect(updateThread).not.toHaveBeenCalled()
    expect(setThreads).toHaveBeenCalled()
  })

  it('removes the project from a Cowork session with an explicit clear', () => {
    state.threads = { c: { id: 'c', metadata: { mode: 'cowork', project } } }
    useCoworkSessions.setState({ sessions: [session('c', { project })] })
    updateThreadProject('c', undefined)
    const s = useCoworkSessions.getState().sessions[0]
    expect('project' in s).toBe(true)
    expect(s.project).toBeUndefined()
  })

  it('refuses an unavailable session: its assignment would be undone by persistence', () => {
    state.threads = { c: { id: 'c', metadata: { mode: 'cowork' } } }
    useCoworkSessions.setState({ sessions: [session('c', { unavailable: 'missing-thread' })] })
    updateThreadProject('c', project)
    expect(useCoworkSessions.getState().sessions[0].project).toBeUndefined()
    expect(updateThread).not.toHaveBeenCalled()
  })

  it('does nothing for an unknown id', () => {
    updateThreadProject('nope', project)
    expect(updateThread).not.toHaveBeenCalled()
    expect(setThreads).not.toHaveBeenCalled()
  })
})
