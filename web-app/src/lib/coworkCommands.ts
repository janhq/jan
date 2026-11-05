import { toast } from 'sonner'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useCoworkRun } from '@/hooks/useCoworkRun'

/**
 * Canned onboarding prompt for `/init`. Sent as a normal user turn so the agent
 * runs it with the regular toolset. Like the TUI's version it writes only the
 * project instructions file, which every later run loads into its prompt; a
 * legacy JAN.md wins over AGENTS.md in the same folder, so one is kept. The
 * 20K budget matches the CLI's `INSTRUCTIONS_WARN_CHARS` (src-tauri
 * `core/cli/tui.rs`), past which it warns at startup.
 */
export const INIT_PROMPT = `Onboard yourself to this project so future sessions start informed. Your only output is the project instructions file in the project root: \`AGENTS.md\`, or \`JAN.md\` if the root already has one (it takes precedence; keep editing it and do not rename it). Do not write skills, memory notes, or any other file.

1. Study the project first. Read the README and any contributor docs, map the directory layout, and find the real build, test, lint, and type-check commands (from the manifests and CI config, not from guesswork). Note the conventions the code actually follows.

2. Write the instructions file. It is loaded into your system prompt every session, so it must earn its tokens: the commands to build/test/lint, the architecture a newcomer cannot infer from the tree, and the conventions worth enforcing. Skip anything obvious from a directory listing, and do not pad it. Keep it well under 20K characters. If the file already exists, read it and correct what has drifted instead of rewriting it wholesale; if it has grown past that size, tighten it. If the project has a \`CLAUDE.md\` but no instructions file, start from it, drop anything aimed at that specific agent, and leave \`CLAUDE.md\` unchanged.

Then report what you wrote and why, briefly.`

/**
 * Slash commands available from the composer. Client-side actions — they never
 * reach the agent (except /init, which submits a canned user turn). `descKey`
 * is an i18n key resolved at render time. mode 'run' executes on select;
 * 'args' fills the input so the user can type an argument (/models -> picker).
 */
export const SLASH_COMMANDS = [
  { name: '/help', descKey: 'common:cmdHelp', mode: 'run' },
  { name: '/clear', descKey: 'common:cmdClear', mode: 'run' },
  { name: '/compact', descKey: 'common:cmdCompact', mode: 'run' },
  { name: '/models', descKey: 'common:cmdModels', mode: 'args' },
  { name: '/plan', descKey: 'common:cmdPlan', mode: 'run' },
  { name: '/todo', descKey: 'common:cmdTodo', mode: 'run' },
  { name: '/tasks', descKey: 'common:cmdTasks', mode: 'run' },
  { name: '/init', descKey: 'common:cmdInit', mode: 'run' },
] as const

/**
 * Render-scoped values and callbacks the dispatcher needs but that live in the
 * CoworkPage component. Injected so the dispatch logic is pure and testable;
 * the durable stores are imported directly.
 */
export type SlashCommandDeps = {
  t: (key: string, opts?: Record<string, unknown>) => string
  running: boolean
  currentId: string | null
  submitTurn: (text: string) => void
  openRail: (kind: 'todos' | 'tasks') => void
  compact: () => void
}

export function runSlashCommand(raw: string, deps: SlashCommandDeps): void {
  const { t, running, currentId, submitTurn, openRail, compact } = deps
  const name = raw.trim().split(/\s+/)[0]
  switch (name) {
    case '/compact':
      if (running) {
        toast.error(t('common:cmdBusy'))
        break
      }
      compact()
      break
    case '/help':
      toast(t('common:commands'), {
        description: SLASH_COMMANDS.map(
          (c) => `${c.name} - ${t(c.descKey)}`
        ).join('\n'),
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
        useCoworkSessions.getState().clearSession(currentId)
        useCoworkRun.getState().clearCodeRun(currentId)
      }
      break
    case '/models':
      // 'args' mode: the picker opens from the menu while "/models" is typed;
      // reaching here means it was submitted with no selection made.
      toast(t('common:cmdModelsHint'))
      break
    case '/plan': {
      if (!currentId) break
      const next = !(
        useCoworkSessions.getState().sessions.find((s) => s.id === currentId)
          ?.planMode ?? false
      )
      useCoworkSessions.getState().setPlanMode(currentId, next)
      toast(t(next ? 'common:cmdPlanOn' : 'common:cmdPlanOff'))
      break
    }
    case '/todo':
      openRail('todos')
      break
    case '/tasks':
      openRail('tasks')
      break
    case '/init':
      if (running) {
        toast.error(t('common:cmdBusy'))
        break
      }
      toast(t('common:cmdInitRunning'))
      submitTurn(INIT_PROMPT)
      break
    default:
      toast.error(t('common:cmdUnknown', { name }))
  }
}
