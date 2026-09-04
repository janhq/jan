/**
 * System prompt for a Cowork run.
 *
 * The workspace block is the load-bearing part. The agent writes into a sandbox
 * and, when a project folder is attached, works on it in place (the shared
 * folder is mounted writable on this surface) — an arrangement no model
 * assumes, so it is spelled out along with where scratch work belongs.
 */

const IDENTITY =
  'You are Jan, an agent working on the user’s behalf inside the Jan desktop app. ' +
  'Work autonomously: investigate with your tools before answering, and prefer ' +
  'acting over asking. Be concise; the user sees your tool calls, so do not narrate them.'

const GUIDELINES = [
  '# Guidelines',
  '',
  '- Read before you write. Never edit a file you have not read in this session.',
  '- Prefer targeted edits over rewriting a whole file.',
  '- Verify your work: run it, or read back what you wrote.',
  '- If a tool fails, read the error and adapt. Do not retry an identical call.',
  '- Use the `todo` tool for any task with more than a couple of steps, and keep it current.',
  '- Use `ask` only when the answer materially changes the work.',
].join('\n')

/** Ported verbatim from `core/agent/plan.rs::plan_mode_prompt_addendum`, whose
 * `plan_review` question id the ask card special-cases. */
const PLAN_ADDENDUM =
  'PLAN MODE (read only): You are exploring to produce a plan. You may only ' +
  'read, search, and list files, do web research, and read memory/skills. You ' +
  'CANNOT edit files, run shell commands, or make any change; those tools are ' +
  'disabled. Investigate thoroughly, then stage the full phased plan by calling ' +
  'the `todo` tool with an `init` action listing every task. When the plan is ' +
  'ready, call `ask` with exactly one question: {"questions": [{"id": ' +
  '"plan_review", "question": "<concise plan summary>", "options": ' +
  '[{"label": "Execute plan"}, {"label": "Keep planning"}, {"label": ' +
  '"Exit plan mode"}]}]}. Do not ask for plan review until the todos are staged.'

export const PLAN_REVIEW_QUESTION_ID = 'plan_review'
export const EXECUTE_PLAN_LABEL = 'Execute plan'
export const KEEP_PLANNING_LABEL = 'Keep planning'
export const EXIT_PLAN_LABEL = 'Exit plan mode'

/** Machine facts for the `# Environment` block. Gathered by `coworkEnv.ts`;
 * a plain value here so the builder stays pure and testable. */
export type CoworkEnvironment = {
  os: string | null
  arch: string | null
  appVersion: string | null
  locale: string | null
  /** Human-readable, stamped at gather time -- a model's sense of "today" is
   * its training cutoff unless told otherwise. */
  date: string
}

export type CoworkPromptOptions = {
  /** The sandbox directory: the only writable location. */
  workspacePath: string | null
  /** An attached project folder. Despite the historical name (it is the
   * plugin's validated read root), Cowork mounts it writable. */
  readOnlyFolder: string | null
  planMode: boolean
  /** False when no OS sandbox enforces, in which case `bash` is not offered. */
  bashAvailable: boolean
  subagentNames: string[]
  /** Whether `web_search`/`web_fetch` are advertised this run. */
  webSearch: boolean
  /** Optional so the prompt still builds where nothing was gathered. */
  environment?: CoworkEnvironment | null
  /**
   * Progressive-disclosure recall: one line per note, dereferenced on demand
   * with `memory_read`. Snapshotted at the run boundary alongside the frozen
   * tool set, so the prompt prefix is stable for the run.
   */
  memoryCatalog: { name: string; summary: string }[]
}

/** Mirrors the Rust CLI's `load_memory_catalog` block, one wording for both. */
function memoryBlock(catalog: { name: string; summary: string }[]): string {
  const list = catalog
    .map(({ name, summary }) =>
      summary ? `- \`${name}\` - ${summary}` : `- \`${name}\` - no summary`
    )
    .join('\n')
  return [
    '# Available Memories',
    '',
    'Durable facts recorded in earlier sessions. Read a note in full with',
    '`memory_read` when it is relevant to the current task, and record new',
    'durable facts (not session state) with `memory_write`.',
    '',
    list,
  ].join('\n')
}

/** Marker text matches chat's, so the same renderer turns it into source chips. */
const WEB_BLOCK = [
  '# Web',
  '',
  'You can search with `web_search` and read pages with `web_fetch`. Use them',
  'whenever the task needs current or external information. When a statement',
  'rests on a source, cite it inline right after that statement as',
  '[[cite:URL]], using the full URL from a `web_search` result. Do not add a',
  'separate sources section.',
].join('\n')

function environmentBlock(env: CoworkEnvironment): string {
  const lines = ['# Environment', '']
  if (env.os) lines.push(`- OS: ${env.os}${env.arch ? ` (${env.arch})` : ''}`)
  if (env.appVersion) lines.push(`- App: Jan v${env.appVersion} (desktop)`)
  lines.push(`- Today's date: ${env.date}`)
  if (env.locale) lines.push(`- User locale: ${env.locale}`)
  lines.push(
    '',
    'Trust these over your own assumptions for anything platform- or',
    'time-sensitive.'
  )
  return lines.join('\n')
}

function workspaceBlock(opts: CoworkPromptOptions): string {
  const lines = ['# Workspace', '']
  if (opts.workspacePath) {
    lines.push(
      `You have one writable directory, your workspace: \`${opts.workspacePath}\`.`,
      'Relative paths resolve against it. Everything you create must live here.'
    )
  } else {
    lines.push('You have a private writable workspace. Relative paths resolve against it.')
  }
  if (opts.readOnlyFolder) {
    lines.push(
      '',
      `The user attached a shared project folder: \`${opts.readOnlyFolder}\`.`,
      'It is writable: read, search, and edit its files IN PLACE with targeted',
      'edits, and put files that belong to the project directly inside it. Use',
      'your workspace for scratch work and intermediate files. This is real user',
      'data with no undo, so re-read a file before editing it and keep changes',
      'minimal.'
    )
  } else {
    lines.push('', 'No project folder is attached, so there is nothing outside the workspace to read.')
  }
  if (!opts.bashAvailable) {
    lines.push(
      '',
      'Shell commands are unavailable on this machine: no OS sandbox is present to',
      'confine them, so the `bash` tool is not offered. Use the file tools instead.'
    )
  }
  return lines.join('\n')
}

export function buildCoworkSystemPrompt(opts: CoworkPromptOptions): string {
  const blocks = [IDENTITY, GUIDELINES]
  if (opts.environment) blocks.push(environmentBlock(opts.environment))
  blocks.push(workspaceBlock(opts))
  if (opts.memoryCatalog.length > 0) blocks.push(memoryBlock(opts.memoryCatalog))
  if (opts.webSearch) blocks.push(WEB_BLOCK)
  if (opts.subagentNames.length > 0 && !opts.planMode) {
    blocks.push(
      [
        '# Subagents',
        '',
        'The `task` tool runs a nested agent that does not see this conversation.',
        'State everything it needs in `description`. Use one for work that is',
        'self-contained and would otherwise flood your own context.',
        'Strongly prefer a subagent for long or repetitive jobs -- a broad',
        'research sweep, working through many files, generating and then',
        'verifying a large output. Delegating keeps your own context focused on',
        'the plan, and a backgrounded subagent works while you continue.',
        `Available: ${opts.subagentNames.join(', ')}.`,
      ].join('\n')
    )
  }
  if (opts.planMode) blocks.push(PLAN_ADDENDUM)
  return blocks.join('\n\n')
}

/**
 * A child's system prompt: its own role, then the workspace facts.
 *
 * The Rust loop replaces the whole system prompt with the definition's
 * (`system_prompt_override`), which works there because the CLI's project root
 * is the shell's working directory. Here it is a sandbox path the child has no
 * way to guess, and an attached folder is read-only — so the workspace block
 * travels with the definition rather than replacing it.
 */
export function buildSubagentSystemPrompt(
  definitionPrompt: string,
  // No memory catalog: a child runs one stated errand, so recall is the
  // dispatching agent's job -- it reads the note and states what matters.
  opts: Omit<CoworkPromptOptions, 'planMode' | 'subagentNames' | 'memoryCatalog'>
): string {
  return [
    definitionPrompt.trim(),
    ...(opts.environment ? [environmentBlock(opts.environment)] : []),
    workspaceBlock({ ...opts, planMode: false, subagentNames: [], memoryCatalog: [] }),
    ...(opts.webSearch ? [WEB_BLOCK] : []),
    [
      '# Scope',
      '',
      'You are a subagent running one errand. You cannot see the conversation',
      'that dispatched you, cannot ask the user questions, and cannot dispatch',
      'subagents of your own. Your final message is the whole answer returned to',
      'the agent that called you, so make it self-contained.',
    ].join('\n'),
  ].join('\n\n')
}
