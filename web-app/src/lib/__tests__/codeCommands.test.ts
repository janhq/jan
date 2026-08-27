import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the side-channel dependencies before importing the module under test.
vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  })
  return { toast }
})
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { toast } from 'sonner'
import { invoke } from '@tauri-apps/api/core'
import { useCodeSessions } from '@/hooks/useCodeSessions'
import { useCodeRun } from '@/hooks/useCodeRun'
import { usePrompt } from '@/hooks/usePrompt'
import { useModelProvider } from '@/hooks/useModelProvider'
import { runSlashCommand, INIT_PROMPT } from '@/lib/codeCommands'
import type { SlashCommandDeps } from '@/lib/codeCommands'
import type { CodeSession } from '@/hooks/useCodeSessions'

const mockedToast = vi.mocked(toast)
const mockedToastError = vi.mocked(toast.error)
const mockedInvoke = vi.mocked(invoke)

// tap the last toast call's description (used by /threads, /resume, /help)
const lastToastDescription = (): string | undefined => {
  const calls = mockedToast.mock.calls
  const last = calls[calls.length - 1]
  return last && last[1] ? (last[1] as { description?: string }).description : undefined
}

// A helper that builds a fresh deps object with spies, so each test controls
// exactly which render-scoped values the command sees.
function makeDeps(overrides: Partial<SlashCommandDeps> = {}): SlashCommandDeps {
  return {
    t: (key: string) => key,
    running: false,
    currentId: null,
    current: undefined,
    selectedModel: { id: 'model-1' },
    submitTurn: vi.fn().mockResolvedValue(undefined),
    setActivePanel: vi.fn(),
    allModels: [
      { providerName: 'provider-1', id: 'model-1', label: 'Model One' },
    ],
    ...overrides,
  }
}

function seedSession(session: Partial<CodeSession> & { id: string }): CodeSession {
  const full: CodeSession = {
    id: session.id,
    title: session.title ?? 'Untitled',
    folder: session.folder ?? null,
    turns: session.turns ?? [],
    history: session.history ?? [],
    updated: Date.now(),
    ...session,
  }
  useCodeSessions.setState({
    sessions: [
      ...useCodeSessions.getState().sessions.filter((s) => s.id !== session.id),
      full,
    ],
    currentId: full.id,
  })
  return full
}

// jsdom in this vitest config exposes a bare `localStorage` object with no
// methods, and useCodeSessions persists through backendStorage -> localStorage
// on web. Provide a minimal in-memory implementation so setState doesn't reject.
beforeAll(() => {
  const store: Record<string, string> = {}
  const lstub = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = String(v)),
    removeItem: (k: string) => void delete store[k],
    clear: () => Object.keys(store).forEach((k) => delete store[k]),
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: lstub,
    configurable: true,
    writable: true,
  })
})
describe('runSlashCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCodeSessions.setState({
      sessions: [],
      currentId: null,
    })
    useCodeRun.setState({ runId: {} })
    usePrompt.setState({ prompt: '' })
    useModelProvider.setState({
      selectedModel: { id: 'model-1' },
      providers: [
        {
          provider: 'provider-1',
          models: [{ id: 'model-1' }],
        },
      ],
    } as never)
    // resolve invoke so /compact's promise doesn't dangle
    mockedInvoke.mockResolvedValue([])
  })

  describe('/init', () => {
    it('starts the onboarding turn with INIT_PROMPT when a folder and model are set', () => {
      const currentId = seedSession({ id: 's1', folder: '/repo' }).id
      const submitTurn = vi.fn().mockResolvedValue(undefined)
      runSlashCommand('/init', makeDeps({ currentId, current: { folder: '/repo' }, submitTurn }))

      expect(submitTurn).toHaveBeenCalledTimes(1)
      expect(submitTurn).toHaveBeenCalledWith(INIT_PROMPT, 's1')
      expect(mockedToast.success).toHaveBeenCalledWith('common:cmdInitRunning')
    })

    it('refuses when a run is in flight', () => {
      const submitTurn = vi.fn().mockResolvedValue(undefined)
      runSlashCommand(
        '/init',
        makeDeps({
          running: true,
          current: { folder: '/repo' },
          submitTurn,
        })
      )
      expect(mockedToastError).toHaveBeenCalledWith('common:cmdBusy')
      expect(submitTurn).not.toHaveBeenCalled()
    })

    it('refuses without a folder', () => {
      const submitTurn = vi.fn().mockResolvedValue(undefined)
      runSlashCommand(
        '/init',
        makeDeps({ current: undefined, submitTurn })
      )
      expect(mockedToastError).toHaveBeenCalledWith('common:cmdNeedFolder')
      expect(submitTurn).not.toHaveBeenCalled()
    })

    it('refuses without a model', () => {
      const submitTurn = vi.fn().mockResolvedValue(undefined)
      runSlashCommand(
        '/init',
        makeDeps({
          current: { folder: '/repo' },
          selectedModel: null,
          submitTurn,
        })
      )
      expect(mockedToastError).toHaveBeenCalledWith('common:cmdNeedModel')
      expect(submitTurn).not.toHaveBeenCalled()
    })
  })

  describe('/plan', () => {
    it('turns plan mode on and submits the seed message', () => {
      const sid = seedSession({ id: 's1', folder: '/repo' }).id
      const submitTurn = vi.fn().mockResolvedValue(undefined)
      // DEFAULT_CODE_RUN_MODE is 'yolo' -> not in plan, so this enters plan mode
      runSlashCommand(
        '/plan build the thing',
        makeDeps({ currentId: sid, current: { folder: '/repo' }, submitTurn })
      )
      expect(useCodeSessions.getState().sessions.find((s) => s.id === sid)?.mode).toBe('plan')
      expect(submitTurn).toHaveBeenCalledWith('build the thing', sid)
    })

    it('bare /plan enters plan mode with no seed', () => {
      const sid = seedSession({ id: 's1', folder: '/repo' }).id
      const submitTurn = vi.fn().mockResolvedValue(undefined)
      runSlashCommand(
        '/plan',
        makeDeps({ currentId: sid, current: { folder: '/repo' }, submitTurn })
      )
      expect(useCodeSessions.getState().sessions.find((s) => s.id === sid)?.mode).toBe('plan')
      expect(submitTurn).not.toHaveBeenCalled()
    })

    it('/plan exit leaves plan mode', () => {
      const sid = seedSession({ id: 's1', folder: '/repo', mode: 'plan' }).id
      runSlashCommand(
        '/plan exit',
        makeDeps({ currentId: sid, current: { folder: '/repo' } })
      )
      expect(useCodeSessions.getState().sessions.find((s) => s.id === sid)?.mode).toBe('normal')
    })
  })

  describe('/todo', () => {
    it('bare /todo opens the todo panel', () => {
      const sid = seedSession({ id: 's1' }).id
      const setActivePanel = vi.fn()
      runSlashCommand('/todo', makeDeps({ currentId: sid, setActivePanel }))
      expect(setActivePanel).toHaveBeenCalledWith('todos')
    })

    it('adds a task to the default Tasks phase', () => {
      const sid = seedSession({ id: 's1' }).id
      runSlashCommand(
        '/todo add write the test',
        makeDeps({ currentId: sid, current: { todos: undefined, folder: null } })
      )
      const todos = useCodeSessions.getState().sessions.find((s) => s.id === sid)?.todos
      expect(todos?.phases).toEqual([
        { name: 'Tasks', tasks: [{ content: 'write the test', status: 'pending' }] },
      ])
    })

    it('adds a task to an explicit phase', () => {
      const sid = seedSession({ id: 's1' }).id
      runSlashCommand(
        '/todo add Verify | run the suite',
        makeDeps({ currentId: sid, current: { todos: undefined, folder: null } })
      )
      const todos = useCodeSessions.getState().sessions.find((s) => s.id === sid)?.todos
      expect(todos?.phases).toEqual([
        { name: 'Verify', tasks: [{ content: 'run the suite', status: 'pending' }] },
      ])
    })

    it('appends to an existing phase', () => {
      const sid = seedSession({
        id: 's1',
        todos: { phases: [{ name: 'Tasks', tasks: [{ content: 'first', status: 'pending' }] }] },
      }).id
      runSlashCommand(
        '/todo add second',
        makeDeps({ currentId: sid, current: { todos: undefined, folder: null } })
      )
      const todos = useCodeSessions.getState().sessions.find((s) => s.id === sid)?.todos
      expect(todos?.phases[0].tasks).toEqual([
        { content: 'first', status: 'pending' },
        { content: 'second', status: 'pending' },
      ])
    })

    it('clears todos with /todo clear', () => {
      const sid = seedSession({
        id: 's1',
        todos: { phases: [{ name: 'Tasks', tasks: [{ content: 'x', status: 'pending' }] }] },
      }).id
      runSlashCommand('/todo clear', makeDeps({ currentId: sid, current: { folder: null } }))
      expect(useCodeSessions.getState().sessions.find((s) => s.id === sid)?.todos?.phases).toEqual([])
    })
  })

  describe('/threads', () => {
    it('reports emptiness when there are no sessions', () => {
      runSlashCommand('/threads', makeDeps())
      expect(mockedToast).toHaveBeenCalledWith('common:cmdThreadsEmpty')
    })

    it('excludes sessions with no turns or history from the busy list', () => {
      seedSession({ id: 's1', turns: [], history: [] })
      runSlashCommand('/threads', makeDeps())
      expect(mockedToast).toHaveBeenCalledWith('common:cmdThreads', expect.any(Object))
      expect(lastToastDescription() ?? '').toBe('')
    })

    it('informs busy sessions in a numbered description', () => {
      seedSession({ id: 's1', title: 'First task', folder: '/repo/a', turns: [{ id: 't1' }] as never })
      seedSession({ id: 's2', title: 'Second', folder: '/repo/b', history: [{ role: 'user', content: 'hi' }] })
      runSlashCommand('/threads', makeDeps())
      expect(mockedToast).toHaveBeenCalledWith('common:cmdThreads', expect.any(Object))
      const desc = lastToastDescription() ?? ''
      expect(desc).toContain('1. First task (a)')
      expect(desc).toContain('2. Second (b)')
    })
  })

  describe('/resume', () => {
    it('resumes a session by 1-based index', () => {
      seedSession({ id: 's1', title: 'first', turns: [{ id: 't1' }] as never })
      seedSession({ id: 's2', title: 'second', history: [{ role: 'user', content: 'x' }] })
      runSlashCommand('/resume 2', makeDeps())
      expect(useCodeSessions.getState().currentId).toBe('s2')
    })

    it('resumes a session by id', () => {
      seedSession({ id: 's1', title: 'first', turns: [{ id: 't1' }] as never })
      seedSession({ id: 's2', title: 'second', history: [{ role: 'user', content: 'x' }] })
      runSlashCommand('/resume s1', makeDeps())
      expect(useCodeSessions.getState().currentId).toBe('s1')
    })

    it('lists sessions on bare /resume with /resume N hints', () => {
      seedSession({ id: 's1', title: 'first', turns: [{ id: 't1' }] as never })
      seedSession({ id: 's2', title: 'second', history: [{ role: 'user', content: 'x' }] })
      runSlashCommand('/resume', makeDeps())
      const desc = lastToastDescription() ?? ''
      expect(desc).toContain('/resume 1')
      expect(desc).toContain('/resume 2')
    })
  })

  describe('/clear', () => {
    it('clears the current session when idle', () => {
      const sid = seedSession({
        id: 's1',
        turns: [{ id: 't1' }] as never,
        history: [{ role: 'user', content: 'x' }],
      }).id
      runSlashCommand('/clear', makeDeps({ currentId: sid }))
      const sess = useCodeSessions.getState().sessions.find((s) => s.id === sid)
      expect(sess?.turns).toEqual([])
      expect(sess?.history).toEqual([])
      expect(sess?.subagents).toEqual([])
    })

    it('refuses to clear while running', () => {
      const sid = seedSession({ id: 's1', turns: [{ id: 't1' }] as never }).id
      runSlashCommand('/clear', makeDeps({ currentId: sid, running: true }))
      expect(mockedToastError).toHaveBeenCalledWith('common:cmdBusy')
      expect(useCodeSessions.getState().sessions.find((s) => s.id === sid)?.turns).toHaveLength(1)
    })
  })

  describe('/models', () => {
    it('switches to a matching model and clears the prompt', () => {
      runSlashCommand('/models model-1', makeDeps())
      expect(useModelProvider.getState().selectedModel?.id).toBe('model-1')
      expect(usePrompt.getState().prompt).toBe('')
    })

    it('shows a hint for an unknown model', () => {
      runSlashCommand('/models does-not-exist', makeDeps())
      expect(mockedToast).toHaveBeenCalledWith('common:cmdModelsHint')
    })
  })

  describe('unknown command', () => {
    it('shows an error toast with the typed name', () => {
      runSlashCommand('/nope', makeDeps())
      expect(mockedToastError).toHaveBeenCalledWith(expect.stringContaining('common:cmdUnknown'))
    })
  })
})
