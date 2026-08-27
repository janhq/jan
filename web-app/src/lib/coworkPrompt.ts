/**
 * System prompt for a Cowork run.
 *
 * The workspace block is the load-bearing part. The agent writes into a sandbox
 * and may only *read* an attached project folder, which is an arrangement no
 * model assumes — left unsaid, it retries the same denied write until the step
 * budget runs out.
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

export type CoworkPromptOptions = {
  /** The sandbox directory: the only writable location. */
  workspacePath: string | null
  /** An attached project folder, readable but never writable. */
  readOnlyFolder: string | null
  planMode: boolean
  /** False when no OS sandbox enforces, in which case `bash` is not offered. */
  bashAvailable: boolean
  subagentNames: string[]
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
      `The user attached a project folder: \`${opts.readOnlyFolder}\`.`,
      'It is mounted READ-ONLY. You can read, search and list inside it, but every',
      'write, edit or shell command targeting it will be refused. To work on one of',
      'its files, copy it into your workspace first and edit the copy there. Do not',
      'retry a refused write against the original path.'
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
  const blocks = [IDENTITY, GUIDELINES, workspaceBlock(opts)]
  if (opts.subagentNames.length > 0 && !opts.planMode) {
    blocks.push(
      [
        '# Subagents',
        '',
        'The `task` tool runs a nested agent that does not see this conversation.',
        'State everything it needs in `description`. Use one for work that is',
        'self-contained and would otherwise flood your own context.',
        `Available: ${opts.subagentNames.join(', ')}.`,
      ].join('\n')
    )
  }
  if (opts.planMode) blocks.push(PLAN_ADDENDUM)
  return blocks.join('\n\n')
}
