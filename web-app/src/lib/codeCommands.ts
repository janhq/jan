import { toast } from 'sonner'
import { invoke } from '@tauri-apps/api/core'
import { useCodeSessions, DEFAULT_CODE_RUN_MODE, ensureCurrentSession } from '@/hooks/useCodeSessions'
import { useCodeRun } from '@/hooks/useCodeRun'
import { useModelProvider } from '@/hooks/useModelProvider'
import { usePrompt } from '@/hooks/usePrompt'
import type { CodeMessage, TodoList } from '@/hooks/useCodeSessions'

// Canned onboarding prompt for `/init`, mirroring the TUI's (tui.rs). Sent as
// the user turn so the agent runs it with the normal toolset and permission
// gate; the web transcript shows the turn like any other user message.
export const INIT_PROMPT = `Onboard yourself to this project so future sessions start informed.

1. Study the project first. Read the README and any contributor docs, map the directory layout, and find the real build, test, lint, and type-check commands (from the manifests and CI config, not from guesswork). Note the conventions the code actually follows.

2. Write JAN.md in the project root. It is the only instructions file loaded into your system prompt, and it is loaded every session, so it must earn its tokens: the commands to build/test/lint, the architecture a newcomer cannot infer from the tree, and the conventions worth enforcing. Skip anything obvious from a directory listing, and do not pad it. If JAN.md already exists, read it and correct what has drifted instead of rewriting it wholesale.

3. Write skills with skill_write for the project's repeatable procedures - releasing, running migrations, adding a module, debugging a subsystem - one skill per procedure, only where a real multi-step recipe exists. Do not invent skills to fill space.

4. Record durable project facts with memory_write: decisions, constraints, and gotchas that are true beyond this session and not already stated in the code.

Then report what you wrote and why, briefly.`

// Slash commands available from the input. Client-side actions - they never hit
// the agent. `descKey` is an i18n key resolved at render time. mode 'run'
// executes immediately; 'args' fills the input so the user can pick an argument
// (e.g. /models -> model picker).
export const SLASH_COMMANDS = [
  { name: '/help', descKey: 'common:cmdHelp', mode: 'run' },
  { name: '/clear', descKey: 'common:cmdClear', mode: 'run' },
  { name: '/compact', descKey: 'common:cmdCompact', mode: 'run' },
  { name: '/goal', descKey: 'common:cmdGoal', mode: 'args' },
  { name: '/models', descKey: 'common:cmdModels', mode: 'args' },
  { name: '/init', descKey: 'common:cmdInit', mode: 'run' },
  { name: '/plan', descKey: 'common:cmdPlan', mode: 'args' },
  { name: '/todo', descKey: 'common:cmdTodo', mode: 'args' },
  { name: '/threads', descKey: 'common:cmdThreads', mode: 'run' },
  { name: '/resume', descKey: 'common:cmdResume', mode: 'args' },
] as const

// Render-scoped values and callbacks `runSlashCommand` needs but that live in
// the CodePage component. Everything here is injected so the dispatch logic is
// pure and testable; the durable stores (useCodeSessions, useCodeRun,
// useModelProvider, usePrompt) are imported directly.
export type SlashCommandDeps = {
  t: (key: string, opts?: Record<string, unknown>) => string
  running: boolean
  currentId: string | null
  current: { folder: string | null; todos?: TodoList } | undefined
  selectedModel: { id: string } | null | undefined
  submitTurn: (text: string, sid: string) => Promise<unknown>
  setActivePanel: (view: 'subagents' | 'diff' | 'todos' | 'preview') => void
  allModels: { providerName: string; id: string; label: string }[]
}

export function runSlashCommand(raw: string, deps: SlashCommandDeps) {
  const { t, running, currentId, current, selectedModel, submitTurn, setActivePanel, allModels } = deps
  const parts = raw.trim().split(/\s+/)
  const name = parts[0]
  const arg = parts.slice(1).join(' ')
  switch (name) {
    case '/help':
      toast(t('common:commands'), {
        description: SLASH_COMMANDS.map((c) => `${c.name} — ${t(c.descKey)}`).join('\n'),
      })
      break
    case '/clear':
      // Clearing mid-run would wipe the session the in-flight run is about to
      // commit its transcript into, leaving it inconsistent.
      if (running) {
        toast.error(t('common:cmdBusy'))
        break
      }
      if (currentId) {
        useCodeSessions.getState().clearSession(currentId)
        useCodeRun.getState().clearCodeRun(currentId)
      }
      break
    case '/compact': {
      if (running) {
        toast.error(t('common:cmdBusy'))
        break
      }
      if (!currentId || !selectedModel?.id) {
        toast.error(t('common:selectModel'))
        break
      }
      const session = useCodeSessions.getState().sessions.find((s) => s.id === currentId)
      const before = session?.history.length ?? 0
      invoke<CodeMessage[]>('agent_compact', {
        modelId: selectedModel.id,
        messages: session?.history ?? [],
      })
        .then((compacted) => {
          if (compacted.length < before) {
            useCodeSessions.getState().setHistory(currentId, compacted)
            toast.success(
              t('common:cmdCompacted', {
                before,
                after: compacted.length,
              })
            )
          } else {
            toast(t('common:cmdNothingToCompact'))
          }
        })
        .catch((e) => toast.error(t('common:cmdCompactFailed', { error: String(e) })))
      break
    }
    case '/goal': {
      if (!currentId) break
      const goal = useCodeSessions.getState().sessions.find((s) => s.id === currentId)?.goal
      const condition = arg.trim()
      if (condition === 'clear') {
        useCodeSessions.getState().setGoal(currentId, null)
        toast(goal ? t('common:cmdGoalCleared') : t('common:cmdGoalNone'))
        break
      }
      if (!condition) {
        if (!goal) {
          toast(t('common:cmdGoalNone'))
        } else {
          toast(
            t('common:cmdGoalStatus', {
              status: goal.status,
              condition: goal.condition,
              turns: goal.turns,
              reason: goal.lastReason || '—',
            })
          )
        }
        break
      }
      if (condition.length > 4096) {
        toast.error(t('common:cmdGoalTooLong'))
        break
      }
      // Mirror the TUI's `set_goal` (tui.rs): setting a goal both arms it and
      // immediately starts the first turn with the condition as the prompt.
      // Gate on the same preconditions a real run needs so the "Goal set"
      // toast never lies about work that can't actually start.
      if (running) {
        toast.error(t('common:cmdBusy'))
        break
      }
      if (!current?.folder) {
        toast.error(t('common:selectFolder'))
        break
      }
      if (!selectedModel?.id) {
        toast.error(t('common:selectModel'))
        break
      }
      useCodeSessions.getState().setGoal(currentId, {
        condition,
        turns: 0,
        status: 'active',
        lastReason: '',
      })
      toast.success(t('common:cmdGoalSet', { condition }))
      // The condition is the first prompt; on_done triggers the evaluator,
      // which drives auto-continuation from there (see the goal block after
      // agent_run below).
      submitTurn(condition, currentId).catch((err) => {
        console.error('Failed to start goal turn:', err)
      })
      break
    }
    case '/init': {
      if (running) {
        toast.error(t('common:cmdBusy'))
        break
      }
      if (!current?.folder) {
        toast.error(t('common:cmdNeedFolder'))
        break
      }
      if (!selectedModel?.id) {
        toast.error(t('common:cmdNeedModel'))
        break
      }
      toast.success(t('common:cmdInitRunning'))
      const sid = currentId ?? ensureCurrentSession()
      submitTurn(INIT_PROMPT, sid).catch((err) => {
        console.error('Failed to start init:', err)
      })
      break
    }
    case '/plan': {
      const sid = currentId ?? ensureCurrentSession()
      const session = useCodeSessions.getState().sessions.find((s) => s.id === sid)
      const curMode = session?.mode ?? DEFAULT_CODE_RUN_MODE
      const p = arg.trim()
      if (p === 'exit') {
        if (curMode === 'plan') {
          useCodeSessions.getState().setMode(sid, 'normal')
          toast(t('common:cmdPlanOff'))
        } else {
          toast(t('common:cmdPlanNotIn'))
        }
        break
      }
      if (curMode === 'plan') {
        if (!p) {
          toast(t('common:cmdPlanAlready'))
        } else {
          toast.success(t('common:cmdPlanOn'))
          submitTurn(p, sid).catch((err) => {
            console.error('Failed to submit plan turn:', err)
          })
        }
        break
      }
      // Enter plan mode, optionally seeding it with a message.
      useCodeSessions.getState().setMode(sid, 'plan')
      toast.success(t('common:cmdPlanOn'))
      if (p) {
        submitTurn(p, sid).catch((err) => {
          console.error('Failed to submit plan turn:', err)
        })
      }
      break
    }
    case '/todo': {
      const sid = currentId ?? ensureCurrentSession()
      const session = useCodeSessions.getState().sessions.find((s) => s.id === sid)
      const todos: TodoList = session?.todos ?? { phases: [] }
      const p = arg.trim()
      if (!p) {
        // Bare `/todo`: open the todo editor panel.
        setActivePanel('todos')
        break
      }
      if (p === 'clear') {
        if (todos.phases.length === 0) {
          toast(t('common:cmdTodoNone'))
          break
        }
        useCodeSessions.getState().setTodos(sid, { phases: [] })
        toast.success(t('common:cmdTodoCleared'))
        break
      }
      const rest = p.startsWith('add') ? p.slice('add'.length).trim() : null
      if (rest === null) {
        toast(t('common:cmdTodoUsage'))
        break
      }
      const [phase, text] = rest.includes('|')
        ? (() => {
            const i = rest.indexOf('|')
            return [rest.slice(0, i).trim(), rest.slice(i + 1).trim()]
          })()
        : ['Tasks', rest]
      if (!text) {
        toast(t('common:cmdTodoUsage'))
        break
      }
      const next: TodoList = {
        phases: todos.phases.some((ph) => ph.name === phase)
          ? todos.phases.map((ph) =>
              ph.name === phase
                ? {
                    ...ph,
                    tasks: [...ph.tasks, { content: text, status: 'pending' }],
                  }
                : ph
            )
          : [
              ...todos.phases,
              { name: phase, tasks: [{ content: text, status: 'pending' }] },
            ],
      }
      useCodeSessions.getState().setTodos(sid, next)
      toast.success(t('common:cmdTodoAdded', { phase }))
      break
    }
    case '/threads': {
      const sessions = useCodeSessions.getState().sessions
      if (sessions.length === 0) {
        toast(t('common:cmdThreadsEmpty'))
        break
      }
      toast(t('common:cmdThreads'), {
        description: sessions
          .filter((s) => s.turns.length > 0 || s.history.length > 0)
          .map(
            (s, i) =>
              `${i + 1}. ${s.title || 'untitled'} ${
                s.folder ? `(${s.folder.split(/[/\\]/).pop()})` : ''
              }`
          )
          .join('\n'),
      })
      break
    }
    case '/resume': {
      const sessions = useCodeSessions.getState().sessions.filter(
        (s) => s.turns.length > 0 || s.history.length > 0
      )
      const p = arg.trim()
      if (!p) {
        if (sessions.length === 0) {
          toast(t('common:cmdThreadsEmpty'))
          break
        }
        // Bare `/resume`: list sessions in a toast with 1-based indices.
        toast(t('common:cmdThreads'), {
          description: sessions
            .map((s, i) => `${i + 1}. ${s.title || 'untitled'} - /resume ${i + 1}`)
            .join('\n'),
        })
        break
      }
      const idx = Number(p)
      const target = Number.isInteger(idx)
        ? sessions[idx - 1]
        : sessions.find((s) => s.id === p) ?? sessions.find((s) => s.title === p)
      if (!target) {
        toast(t('common:cmdUnknown', { name: `/resume ${p}` }))
        break
      }
      useCodeSessions.getState().selectSession(target.id)
      toast.success(t('common:cmdResumed', { title: target.title || 'untitled' }))
      break
    }
    case '/models': {
      const q = arg.toLowerCase()
      const found = allModels.find(
        (m) => m.id.toLowerCase() === q || m.label.toLowerCase() === q
      )
      if (found) {
        useModelProvider.getState().selectModelProvider(found.providerName, found.id)
        usePrompt.getState().setPrompt('')
        toast.success(t('common:cmdModelSwitched', { name: found.id }))
      } else {
        toast(t('common:cmdModelsHint'))
      }
      break
    }
    default:
      toast.error(t('common:cmdUnknown', { name }))
  }
}
