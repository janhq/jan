import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}))

vi.mock('@/lib/backendStorage', () => ({
  backendStorage: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}))

import { toast } from 'sonner'
import {
  runSlashCommand,
  INIT_PROMPT,
  type SlashCommandDeps,
} from '../coworkCommands'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'

const t = (key: string) => key

const makeDeps = (over: Partial<SlashCommandDeps> = {}): SlashCommandDeps => ({
  t,
  running: false,
  currentId: null,
  submitTurn: vi.fn(),
  openRail: vi.fn(),
  compact: vi.fn(),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  useCoworkSessions.setState({ sessions: [], currentId: null })
})

describe('runSlashCommand', () => {
  it('/clear wipes the current session when idle', () => {
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions
      .getState()
      .commitTurns(id, [{ role: 'user', content: 'hi' }], [], [])
    runSlashCommand('/clear', makeDeps({ currentId: id }))
    const s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.turns).toEqual([])
  })

  it('/clear refuses while a run is in flight', () => {
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions
      .getState()
      .commitTurns(id, [{ role: 'user', content: 'hi' }], [], [])
    runSlashCommand('/clear', makeDeps({ currentId: id, running: true }))
    const s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.turns).toHaveLength(1)
    expect(toast.error).toHaveBeenCalledWith('common:cmdBusy')
  })

  it('/plan toggles the session plan mode both ways', () => {
    const id = useCoworkSessions.getState().createSession()
    const deps = makeDeps({ currentId: id })
    runSlashCommand('/plan', deps)
    expect(
      useCoworkSessions.getState().sessions.find((x) => x.id === id)?.planMode
    ).toBe(true)
    runSlashCommand('/plan', deps)
    expect(
      useCoworkSessions.getState().sessions.find((x) => x.id === id)?.planMode
    ).toBe(false)
  })

  it('/todo and /tasks open their rails', () => {
    const openRail = vi.fn()
    runSlashCommand('/todo', makeDeps({ openRail }))
    runSlashCommand('/tasks', makeDeps({ openRail }))
    expect(openRail).toHaveBeenNthCalledWith(1, 'todos')
    expect(openRail).toHaveBeenNthCalledWith(2, 'tasks')
  })

  it('/init submits the onboarding prompt when idle, refuses mid-run', () => {
    const submitTurn = vi.fn()
    runSlashCommand('/init', makeDeps({ submitTurn }))
    expect(submitTurn).toHaveBeenCalledWith(INIT_PROMPT)

    submitTurn.mockClear()
    runSlashCommand('/init', makeDeps({ submitTurn, running: true }))
    expect(submitTurn).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('common:cmdBusy')
  })

  it('/compact runs when idle, refuses mid-run', () => {
    const compact = vi.fn()
    runSlashCommand('/compact', makeDeps({ compact }))
    expect(compact).toHaveBeenCalledOnce()

    compact.mockClear()
    runSlashCommand('/compact', makeDeps({ compact, running: true }))
    expect(compact).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('common:cmdBusy')
  })

  it('an unknown command reports itself instead of failing silently', () => {
    runSlashCommand('/nope', makeDeps())
    expect(toast.error).toHaveBeenCalledWith('common:cmdUnknown')
  })
})
