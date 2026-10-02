import {
  convertToModelMessages,
  streamText,
  type LanguageModel,
  type Tool,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import type { Usage } from '@/types/coworkSession'
import type { SubagentDefinition } from '@/lib/coworkSubagentRegistry'
import {
  ASK_TOOL_NAME,
  TASK_TOOL_NAME,
  TODO_TOOL_NAME,
} from '@/lib/coworkTools'
import { MONITOR_TOOL_NAME } from '@/lib/coworkMonitor'
import { MAX_SUBAGENT_STEPS } from '@/lib/coworkBudget'
import { createStepMetadata } from '@/lib/stepMetadata'
import {
  runTurn,
  type PendingToolCall,
  type StreamSink,
  type ToolOutcome,
} from '@/lib/coworkRunner'
import {
  buildSubagentSystemPrompt,
  type CoworkEnvironment,
} from '@/lib/coworkPrompt'
import type { StreamEvent } from '@/hooks/useCoworkRun'

/**
 * Nested subagent runs.
 *
 * Deliberately not routed through `CoworkChatTransport`: the transport writes
 * app-global singletons (`setCurrentStreamThreadId`, `updateLoadingModel`,
 * `updateLiveTokenStats`) that a nested run would clobber for its parent, so the
 * header would report the child's progress as the session's. This calls
 * `streamText` directly and reuses only the parent's already-created model
 * instance, so a child costs no second llama-server load.
 *
 * The cost of that reuse: llama.cpp slot params are baked in at model creation,
 * so a child inherits the parent's `thread_id` and prefills over its KV prefix,
 * which the parent then re-prefills on its next step. Giving a child its own
 * identity would park and restore instead, at the price of a state file per
 * dispatch; concurrent children would still evict each other, since they share
 * the slot and each has a different system prompt.
 *
 * `task` is non-blocking, as `dispatch_subagent` is in Rust: it returns the file
 * its child's answer will be written to, and the child runs on. Blocking held
 * the tool call open for the whole errand -- so the transcript sat on a running
 * frame, and a fan-out could not be reported one child at a time. The parent
 * hears about each completion through a `<SYSTEM>` ping instead (see
 * `SubagentInbox`), which is also what lets it keep working meanwhile.
 */

/** Concurrent children, mirroring `DEFAULT_MAX_PARALLEL_SUBAGENTS`. */
export const MAX_PARALLEL_SUBAGENTS = 3

/**
 * Characters of a child's answer carried in a ping that has no file to point
 * at. Anything past this is lost, which is why a file is much preferred.
 * Mirrors the Rust `SUBAGENT_INLINE_MAX_BYTES`.
 */
export const SUBAGENT_INLINE_MAX = 8 * 1024

/**
 * The `task` result for a phased dispatch, reported the moment phase 1 is
 * launched. Port of the Rust `format_dispatched_plan`: single-phase vs
 * multi-phase wording, the blackboard note (or the inline-note fallback when
 * there is no scratch), and the "these are the subagents' now" hand-off.
 */
export function formatDispatchedPlan(
  plan: DispatchPlan,
  blackboardDir: string | null
): string {
  const firstPhaseNames = plan.phases[0].subagents.map((s) => s.name)
  const names = firstPhaseNames.join(', ')
  const phaseCount = plan.phases.length
  const totalSubagents = plan.phases.reduce(
    (n, p) => n + p.subagents.length,
    0
  )
  const whereAnswers = blackboardDir
    ? ` Each answer is written to ${blackboardDir}/<name>.md; read those files when you need them.`
    : ' Each answer rides the note that tells you it finished.'
  const head =
    phaseCount > 1
      ? `Dispatched a ${phaseCount}-phase plan of ${totalSubagents} subagents. Phase 1 is now running: ${names}. Later phases start automatically as each phase finishes, each receiving the previous phase's results.`
      : `Dispatched ${totalSubagents} subagent(s) running concurrently in the background: ${names}.`
  return (
    `${head}${whereAnswers} These tasks are the subagents' now -- do not do them yourself; ` +
    "you'll be pinged as each finishes."
  )
}

/**
 * What a finished child is reported as, in the two registers it needs.
 *
 * `text` is the `<SYSTEM>` ping the model gets (port of the Rust
 * `completion_notice`, with one difference: with no file to point at, the answer
 * itself rides along, since nothing else would carry it). `headline` is the
 * transcript row -- the same fact without the instructions, which are addressed
 * to the model and read as clutter to anyone else.
 *
 * Two fields rather than one string the UI trims: the split is a fact about
 * what was written, and recovering it by cutting at the first full stop would
 * be guessing at text this module produced.
 */
export type SubagentNotice = { headline: string; text: string }

export function subagentCompletionNotice(opts: {
  name: string
  callId: string
  savedPath: string | null
  output: string
  isError?: boolean
}): SubagentNotice {
  const who = `Subagent '${opts.name}' (${opts.callId})`
  if (opts.isError) {
    const headline = `${who} failed: ${opts.output}`
    return { headline, text: headline }
  }
  const headline = `${who} finished`
  const detail = opts.savedPath
    ? `Its full answer is in ${opts.savedPath} -- read that file when you need it.`
    : `Its answer:\n\n${opts.output.slice(0, SUBAGENT_INLINE_MAX)}`
  return { headline, text: `${headline}. ${detail}` }
}

/**
 * The single `<SYSTEM>` ping delivered when a multi-phase plan finishes -- the
 * one time a phased dispatch rings the parent's doorbell (every child ran
 * silent). Port of the Rust `plan_completion_notice`: each final-phase child
 * whose answer was saved is pointed at its file; one with no file (unconfined,
 * or a failure) rides inline, bounded.
 */
export function planCompletionNotice(opts: {
  phaseCount: number
  totalSubagents: number
  finalPhase: PlanChildOutcome[]
}): SubagentNotice {
  const { phaseCount, totalSubagents, finalPhase } = opts
  const headline = `Subagent plan finished: ${totalSubagents} subagent(s) across ${phaseCount} phases`
  const parts = finalPhase.map(({ name, result, savedPath }) => {
    const body = result.isError
      ? `failed: ${result.output}`
      : savedPath
        ? `see ${savedPath}`
        : result.output.slice(0, SUBAGENT_INLINE_MAX)
    return `### ${name}\n\n${body}`
  })
  const text = parts.length
    ? `${headline}. Final phase:\n\n${parts.join('\n\n')}`
    : `${headline}.`
  return { headline, text }
}

/**
 * Completions the parent has not been told about yet, and the count of children
 * that could still produce one.
 *
 * The runner asks this whether to keep the run alive: a model that stops while a
 * child is still going would otherwise end the run, and the answer would have
 * nowhere to land. `finish` queues the ping before dropping the running count,
 * so `pending` can never read false in the window between the two.
 */
export class SubagentInbox {
  private queue: SubagentNotice[] = []
  private running = 0
  private waiters: Array<() => void> = []

  begin(): void {
    this.running += 1
  }

  finish(notice: SubagentNotice): void {
    this.queue.push(notice)
    this.running -= 1
    this.wake()
  }

  /** Queue a ping without closing a running slot: a monitor's non-terminal
   * match, where the watcher is still owed further work. */
  note(notice: SubagentNotice): void {
    this.queue.push(notice)
    this.wake()
  }

  /** Release a running slot with nothing to report: a start that failed after
   * `begin`, or a monitor the model stopped itself (its own tool result already
   * says so). */
  abandon(): void {
    this.running -= 1
    this.wake()
  }

  /** Take every queued ping, oldest first. */
  take(): SubagentNotice[] {
    const out = this.queue
    this.queue = []
    return out
  }

  pending(): boolean {
    return this.queue.length > 0 || this.running > 0
  }

  /** Resolve when a ping is available, when nothing is left to wait for, or
   * when the run is cancelled -- never hang past the run that owns it. */
  wait(signal?: AbortSignal): Promise<void> {
    if (!this.pending() || this.queue.length > 0 || signal?.aborted) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      const done = () => {
        signal?.removeEventListener('abort', done)
        resolve()
      }
      this.waiters.push(done)
      signal?.addEventListener('abort', done, { once: true })
    })
  }

  private wake(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const resolve of waiters) resolve()
  }
}

/**
 * Always granted to a child, whatever the allowlist says.
 *
 * A skill is a procedure the child may need to follow, and a Claude-style
 * `tools:` list never names these — so a narrowed toolset must not strip them.
 * Read-side only: authoring stays with the top-level agent.
 * Ported from `subagent.rs::SUBAGENT_SKILL_TOOLS`.
 */
const SUBAGENT_SKILL_TOOLS = ['skill_list', 'skill_read']

/**
 * Never offered to a child, whatever the allowlist says.
 *
 * `task` is the depth cap: a subagent cannot spawn subagents. `ask` and `todo`
 * belong to the parent's conversation — no card is rendered for a child, and the
 * todo list is the session's, not the errand's. Matches the Rust child args,
 * which null out `ask_requests` and `todo_registry`.
 */
const WITHHELD_FROM_SUBAGENTS = new Set([
  TASK_TOOL_NAME,
  ASK_TOOL_NAME,
  TODO_TOOL_NAME,
  // A monitor pings the run's inbox, which belongs to the parent's
  // conversation; a child has no inbox, so its watcher would report to no one.
  // (The Rust CLI differs: there a child run owns a registry of its own.)
  MONITOR_TOOL_NAME,
])

/**
 * One subagent within a phased dispatch. `name` is a saved definition's name or,
 * when nothing matches, the identity of an ephemeral generalist; it is also the
 * blackboard file the answer is written to (`blackboard/<name>.md`).
 * `description` is the subagent's sole task (the schema calls it `task`). Ported
 * from `subagent.rs::SubagentRequest`.
 */
export type SubagentRequest = {
  name: string
  description: string
  allowed_tools?: string[]
}

/** A group of subagents that run concurrently; the next phase starts only once
 * every one here has finished. `number` is the model's own `phase` key for the
 * group (what the "phase N" badge shows). Ported from `subagent.rs::Phase`. */
export type Phase = { number: number; subagents: SubagentRequest[] }

/** A parsed `task` call: one or more ordered phases. Ported from
 * `subagent.rs::DispatchPlan`. */
export type DispatchPlan = { phases: Phase[] }

export type ResolvedSubagent = {
  name: string
  systemPrompt: string
  /** `null` inherits the parent's toolset minus what is withheld. */
  allowedTools: string[] | null
  model: string | null
}

/** Longest subagent name accepted. Mirrors `subagent.rs::MAX_SUBAGENT_NAME_LEN`;
 * kept short so the validated name maps to `blackboard/<name>.md` verbatim. */
const MAX_SUBAGENT_NAME_LEN = 64
/** `[A-Za-z0-9_-]`: a name is a single path component, mirroring
 * `subagent.rs::validate_name`. */
const SUBAGENT_NAME_RE = /^[A-Za-z0-9_-]+$/

/**
 * Parse a `dispatch_subagent` tool-call argument object into an ordered plan, or
 * a helpful error string.
 *
 * The wire shape is a flat `subagents` array; each subagent's optional `phase`
 * (a non-negative integer, default 0) groups it into a stage. Subagents sharing
 * a `phase` run together; lower phases run first. One shape covers both a plain
 * fan-out (omit `phase`) and a pipeline (raise `phase`). Names are validated
 * (charset + length) and required unique across the whole plan, since each is a
 * blackboard filename and a panel identity. Ported from
 * `subagent.rs::parse_dispatch_plan`.
 */
export function parseDispatchPlan(input: unknown): DispatchPlan | string {
  const raw = (input ?? {}) as { subagents?: unknown }
  if (!Array.isArray(raw.subagents)) {
    return '`dispatch_subagent` requires a `subagents` array (each with a name and task, plus an optional integer `phase`)'
  }
  if (raw.subagents.length === 0) {
    return '`subagents` must contain at least one subagent'
  }
  const seen = new Set<string>()
  const byPhase = new Map<number, SubagentRequest[]>()
  for (const subVal of raw.subagents) {
    const sub = (subVal ?? {}) as {
      name?: unknown
      task?: unknown
      phase?: unknown
      allowed_tools?: unknown
    }
    if (typeof sub.name !== 'string' || !sub.name.trim()) {
      return 'each subagent requires a non-empty `name`'
    }
    const name = sub.name
    if (!SUBAGENT_NAME_RE.test(name)) {
      return `invalid subagent name '${name}': use only letters, digits, '-' and '_'`
    }
    if (name.length > MAX_SUBAGENT_NAME_LEN) {
      return `subagent name '${name}' is too long (max ${MAX_SUBAGENT_NAME_LEN} characters)`
    }
    if (seen.has(name)) {
      return `duplicate subagent name '${name}': names must be unique across the whole plan (each is a blackboard filename)`
    }
    seen.add(name)
    if (typeof sub.task !== 'string' || !sub.task.trim()) {
      return `subagent '${name}' requires a \`task\`: it cannot see this conversation, so state everything it needs`
    }
    let phase = 0
    if (sub.phase !== undefined && sub.phase !== null) {
      if (
        typeof sub.phase !== 'number' ||
        !Number.isInteger(sub.phase) ||
        sub.phase < 0
      ) {
        return `subagent '${name}' has an invalid 'phase': use a non-negative integer (0 = the first stage)`
      }
      phase = sub.phase
    }
    const req: SubagentRequest = { name, description: sub.task }
    if (Array.isArray(sub.allowed_tools)) {
      const list = sub.allowed_tools.filter(
        (t): t is string => typeof t === 'string'
      )
      // `[]` means "inherit", not "no tools" (see intersectAllowedTools), so a
      // blank list is dropped rather than handed on as a restriction.
      if (list.length > 0) req.allowed_tools = list
    }
    const group = byPhase.get(phase)
    if (group) group.push(req)
    else byPhase.set(phase, [req])
  }
  // Ascending phase order, so sparse numbers (0, 5) collapse to adjacent stages.
  const phases: Phase[] = [...byPhase.keys()]
    .sort((a, b) => a - b)
    .map((number) => ({ number, subagents: byPhase.get(number)! }))
  return { phases }
}

/**
 * System prompt for a subagent dispatched without a saved definition: a focused
 * generalist whose closing report becomes the next phase's input. Ported
 * verbatim from `subagent.rs::ephemeral_subagent_prompt`.
 */
function ephemeralSubagentPrompt(name: string): string {
  return (
    `You are "${name}", a focused subagent handling one task as part of a larger plan. ` +
    'Do exactly the task you are given, using your tools as needed, and do not wait for ' +
    'clarification -- you cannot receive any. When you finish, end with a concise, ' +
    'self-contained report of what you found or did: it is handed verbatim to the agents in ' +
    'the next phase, so include the facts, paths, and decisions they will need.'
  )
}

/** Max bytes of each previous-phase answer folded into a next-phase brief, so a
 * verbose predecessor cannot blow the successor's context. The full answer is
 * always on the blackboard. Mirrors `subagent.rs::PHASE_INPUT_MAX_BYTES`. */
export const PHASE_INPUT_MAX_BYTES = 12 * 1024

/** Cap a finished child's answer to what a next-phase brief can hold before it
 * is retained in memory, so a plan never keeps arbitrarily large outputs across
 * its phases: `injectInputs` would truncate to the same bound at prompt-build
 * anyway, and the full answer is always on the blackboard (the brief header
 * points there). Mirrors the Rust read path, which never holds more than the
 * blackboard file it just read. */
function capRetainedAnswer(output: string): string {
  return truncateToBytes(output, PHASE_INPUT_MAX_BYTES).text
}

/** UTF-8 byte length of a single code point, without allocating. */
function utf8Len(codePoint: number): number {
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}

/** Truncate to at most `maxBytes` UTF-8 bytes at a code-point boundary, so a
 * byte cut never splits a character. Mirrors `subagent.rs::char_boundary`. */
function truncateToBytes(
  s: string,
  maxBytes: number
): { text: string; truncated: boolean } {
  let bytes = 0
  let cut = 0
  for (const ch of s) {
    const n = utf8Len(ch.codePointAt(0) ?? 0)
    if (bytes + n > maxBytes) return { text: s.slice(0, cut), truncated: true }
    bytes += n
    cut += ch.length
  }
  return { text: s, truncated: false }
}

/**
 * Prefix a next-phase brief with the previous phase's results. Ported verbatim
 * (header wording + byte cap + truncation note) from
 * `subagent.rs::inject_inputs`. Empty inputs leave the task unchanged.
 */
export function injectInputs(
  task: string,
  inputs: { name: string; output: string }[]
): string {
  if (inputs.length === 0) return task
  let s =
    '## Results from the previous phase\n\n' +
    'The agents before you produced the following; their full outputs are also on ' +
    'the blackboard at blackboard/<name>.md.\n\n'
  for (const { name, output } of inputs) {
    s += `### ${name}\n`
    const { text, truncated } = truncateToBytes(
      output.trim(),
      PHASE_INPUT_MAX_BYTES
    )
    s += text
    if (truncated) {
      s += `\n\n[...truncated; read blackboard/${name}.md for the full output]`
    }
    s += '\n\n'
  }
  s += '---\n\n'
  s += task
  return s
}

/**
 * The child's effective allowlist: the definition's list, narrowed by the
 * call-site list, narrowed by what the parent itself can call.
 *
 * Never widens. Fails closed on a tool the definition or the parent does not
 * permit, rather than dropping it silently — a child that quietly lost the one
 * tool it needed looks like a model failure. A definition-listed tool the parent
 * lacks *is* dropped: the definition's author cannot know the parent's mode.
 * Ported from `subagent.rs::intersect_allowed_tools`.
 */
export function intersectAllowedTools(
  definition: string[] | null | undefined,
  request: string[] | null | undefined,
  parentTools: string[]
): { tools: string[] | null } | { error: string } {
  const parent = new Set(parentTools)
  const withSkills = (tools: string[]) => {
    const out = [...tools]
    for (const skill of SUBAGENT_SKILL_TOOLS) {
      if (!out.includes(skill) && parent.has(skill)) out.push(skill)
    }
    return out
  }

  if (request && request.length > 0) {
    const effective: string[] = []
    for (const tool of request) {
      if (definition && !definition.includes(tool)) {
        return {
          error: `tool '${tool}' is outside the subagent definition's allowed_tools`,
        }
      }
      if (!parent.has(tool)) {
        return { error: `tool '${tool}' is not available to this run` }
      }
      effective.push(tool)
    }
    return { tools: withSkills(effective) }
  }
  if (definition) {
    return { tools: withSkills(definition.filter((t) => parent.has(t))) }
  }
  return { tools: null }
}

/**
 * Resolve a request against the saved definitions.
 *
 * A name matching a saved definition uses that role and tools; any other name
 * runs as a focused general-purpose agent whose system prompt is the ephemeral
 * generalist text (no error for an unknown name). Only a tool-allowlist conflict
 * errors. Ported from `subagent.rs::resolve_dispatch`.
 */
export function resolveSubagent(
  req: SubagentRequest,
  definitions: SubagentDefinition[],
  parentTools: string[]
): ResolvedSubagent | { error: string } {
  const saved = definitions.find((d) => d.name === req.name)
  const narrowed = intersectAllowedTools(
    saved ? saved.allowed_tools : (req.allowed_tools ?? null),
    // An inline allowlist *is* the ephemeral agent's definition, so it is not
    // also applied as a call-site narrowing (that would compare it to itself).
    saved ? (req.allowed_tools ?? null) : null,
    parentTools
  )
  if ('error' in narrowed) return narrowed
  if (saved) {
    return {
      name: saved.name,
      systemPrompt: saved.system_prompt,
      allowedTools: narrowed.tools,
      model: saved.model,
    }
  }
  return {
    name: req.name,
    systemPrompt: ephemeralSubagentPrompt(req.name),
    allowedTools: narrowed.tools,
    model: null,
  }
}

/** The child's advertised tools: the parent's set, minus what a child never
 * gets, then narrowed to its allowlist. */
export function subagentTools(
  parentTools: Record<string, Tool>,
  allowedTools: string[] | null
): Record<string, Tool> {
  const out: Record<string, Tool> = {}
  for (const [name, tool] of Object.entries(parentTools)) {
    if (WITHHELD_FROM_SUBAGENTS.has(name)) continue
    if (allowedTools && !allowedTools.includes(name)) continue
    out[name] = tool
  }
  return out
}

/** Tool names a child may call, for narrowing a nested request. */
export function parentToolNames(tools: Record<string, Tool>): string[] {
  return Object.keys(tools).filter((n) => !WITHHELD_FROM_SUBAGENTS.has(n))
}

/**
 * A fair FIFO gate over concurrent children.
 *
 * Resolves in call order rather than whatever order the microtask queue
 * happens to run, so the queue position reported to the UI is the position the
 * child actually gets.
 */
class Semaphore {
  private free: number
  private waiters: Array<() => void> = []

  constructor(private readonly cap: number) {
    this.free = Math.max(1, cap)
  }

  /** Number of callers currently waiting, for the queued badge. */
  get waiting(): number {
    return this.waiters.length
  }

  /** Free permits; zero means the next `acquire` will queue. */
  get available(): number {
    return this.free
  }

  async acquire(): Promise<() => void> {
    if (this.free > 0) {
      this.free -= 1
      return () => this.release()
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    return () => this.release()
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) {
      next()
      return
    }
    this.free = Math.min(this.cap, this.free + 1)
  }
}

const gate = new Semaphore(MAX_PARALLEL_SUBAGENTS)

export type SubagentEvents = {
  /** Waiting for a concurrency slot; `waiting` is 1-based FIFO position. */
  onQueued: (waiting: number) => void
  onStart: () => void
  /** One event in the child's own transcript lane. */
  onInner: (event: StreamEvent) => void
  onEnd: (usage: Usage | null) => void
}

export type RunSubagentOptions = {
  resolved: ResolvedSubagent
  description: string
  /** The parent's model instance. Reused so no second load happens. */
  model: LanguageModel
  parentTools: Record<string, Tool>
  system: {
    workspacePath: string | null
    readOnlyFolder: string | null
    bashAvailable: boolean
    environment?: CoworkEnvironment | null
  }
  /** Runs one of the child's tool calls. Same sandbox as the parent. */
  dispatch: (call: PendingToolCall, signal: AbortSignal) => Promise<ToolOutcome>
  signal: AbortSignal
  events: SubagentEvents
  /** Session tokens already spent, so a child cannot outrun the session cap. */
  sessionTokens?: number
  maxSteps?: number
}

export type SubagentResult = {
  /** The child's final answer, which becomes the `task` tool's output. */
  output: string
  usage: Usage | null
  isError?: boolean
  sessionTokens: number
}

/** One model turn for a child, as a UI message stream the runner can consume. */
function childStep(opts: {
  model: LanguageModel
  system: string
  tools: Record<string, Tool>
  messages: UIMessage[]
  signal: AbortSignal
}): Promise<ReadableStream<UIMessageChunk>> {
  return (async () => {
    const modelMessages = await convertToModelMessages(opts.messages, {
      ignoreIncompleteToolCalls: true,
    })
    const result = streamText({
      model: opts.model,
      system: opts.system,
      messages: modelMessages,
      abortSignal: opts.signal,
      tools: Object.keys(opts.tools).length > 0 ? opts.tools : undefined,
      toolChoice: Object.keys(opts.tools).length > 0 ? 'auto' : undefined,
    })
    const stepMetadata = createStepMetadata()
    return result.toUIMessageStream({
      // The same usage-and-speed block the parent's transport stamps, assembled
      // by the same helper, so a child's lane shows the readout chat shows.
      messageMetadata: ({ part }) => stepMetadata.onPart(part),
      onError: (error) =>
        error instanceof Error ? error.message : String(error),
    })
  })()
}

/**
 * Run one subagent to completion and return its final answer.
 *
 * The caller does not await this inline: `task` has already returned, and this
 * promise is what eventually files a ping with the `SubagentInbox`. Never
 * throws -- a failed child comes back as an error string the parent can read
 * and work around.
 */
export async function runSubagent(
  opts: RunSubagentOptions
): Promise<SubagentResult> {
  const { events, resolved } = opts
  let sessionTokens = opts.sessionTokens ?? 0

  // Report the position before queueing, so the badge shows where this child
  // actually sits rather than "queued" with no sense of how far back.
  if (gate.available === 0) events.onQueued(gate.waiting + 1)
  const release = await gate.acquire()
  try {
    if (opts.signal.aborted) {
      events.onEnd(null)
      return { output: '(cancelled)', usage: null, isError: true, sessionTokens }
    }
    events.onStart()

    const tools = subagentTools(opts.parentTools, resolved.allowedTools)
    const system = buildSubagentSystemPrompt(
      resolved.systemPrompt,
      {
        workspacePath: opts.system.workspacePath,
        readOnlyFolder: opts.system.readOnlyFolder,
        bashAvailable: opts.system.bashAvailable && 'bash' in tools,
        // Derived, not passed: the intersection above may have dropped them.
        webSearch: 'web_search' in tools,
        environment: opts.system.environment,
      },
      resolved.name
    )

    // A fresh history: the child does not see the parent's conversation, so the
    // description is the whole brief.
    const messages: UIMessage[] = [
      {
        id: 'sub-user-0',
        role: 'user',
        parts: [{ type: 'text', text: opts.description }],
      } as UIMessage,
    ]

    let finalText = ''
    const sink: StreamSink = {
      onText: (delta) => events.onInner({ type: 'token', text: delta }),
      onReasoning: (delta) =>
        events.onInner({ type: 'reasoning', text: delta }),
      onToolStart: (id, name) =>
        events.onInner({ type: 'tool_call_started', id, name }),
      onToolArgsDelta: (id, delta) =>
        events.onInner({ type: 'tool_call_args_delta', id, delta }),
      onToolCall: (call) =>
        events.onInner({
          type: 'tool_call',
          id: call.toolCallId,
          name: call.toolName,
          args: call.input,
        }),
    }

    let n = 0
    const outcome = await runTurn({
      messages,
      signal: opts.signal,
      maxSteps: opts.maxSteps ?? MAX_SUBAGENT_STEPS,
      sessionTokens,
      deps: {
        sendStep: (msgs, signal) =>
          childStep({
            model: opts.model,
            system,
            tools,
            messages: msgs,
            signal,
          }),
        dispatch: opts.dispatch,
        sink,
        onStep: ({ result, outcomes }) => {
          if (result.text.trim()) finalText = result.text
          // Ahead of the results: the lane hangs it on the child's answer row,
          // and a tool result that arrives first would put a tool row last.
          if (result.metadata) {
            events.onInner({ type: 'step_metadata', metadata: result.metadata })
          }
          for (const [id, o] of outcomes) {
            events.onInner({
              type: 'tool_result',
              id,
              content: o.output,
              is_error: o.isError ?? false,
              diff: o.diff,
            })
          }
        },
        nextMessageId: () => `sub-asst-${n++}`,
      },
    })
    sessionTokens = outcome.sessionTokens
    events.onEnd(outcome.usage)

    if (outcome.stoppedBy === 'error') {
      return {
        output: outcome.errorText ?? 'the subagent failed',
        usage: outcome.usage,
        isError: true,
        sessionTokens,
      }
    }
    if (outcome.stoppedBy === 'aborted') {
      return {
        output: '(the subagent was cancelled)',
        usage: outcome.usage,
        isError: true,
        sessionTokens,
      }
    }
    if (outcome.stoppedBy === 'steps' || outcome.stoppedBy === 'tokens') {
      // Report the cap plainly with whatever it did produce: the parent can
      // usually finish the errand itself, but not if it thinks the child
      // answered in full.
      const cap =
        outcome.stoppedBy === 'steps'
          ? `its ${opts.maxSteps ?? MAX_SUBAGENT_STEPS}-step budget`
          : 'the session token budget'
      return {
        output:
          `The subagent '${resolved.name}' stopped at ${cap} without finishing.` +
          (finalText ? `\n\nIts last output was:\n${finalText}` : ''),
        usage: outcome.usage,
        isError: true,
        sessionTokens,
      }
    }
    return {
      output: finalText || '(the subagent returned no answer)',
      usage: outcome.usage,
      sessionTokens,
    }
  } finally {
    release()
  }
}

/** The lifecycle hooks the phase scheduler drives, so `runDispatchPlan` stays
 * store- and inbox-free (and unit-testable with fakes). */
export type DispatchPlanCallbacks = {
  /** Run one subagent to completion. The caller wires store events + the gate
   * (via `runSubagent`). Its resolved definition is looked up by the caller. */
  runOne: (
    req: SubagentRequest,
    description: string,
    id: string
  ) => Promise<SubagentResult>
  /** Persist a finished child's answer to `blackboard/<name>.md`; returns the
   * model-visible path, or `null` when no scratch is reachable. */
  writeBlackboard: (name: string, content: string) => Promise<string | null>
  /** A child is being dispatched now (for the inbox begin + waiting-promotion). */
  onDispatch: (id: string, name: string) => void
  /** A child finished: its result and the blackboard path (null on failure or
   * when nothing was saved). */
  onComplete: (
    id: string,
    name: string,
    result: SubagentResult,
    savedPath: string | null
  ) => void
  /** The run's abort signal, if the caller has one.
   *
   * Consulted between phases: a cancelled run starts no further phase, because
   * the children of the phase after this one would be dispatched only to be
   * cancelled on arrival -- promoted in the UI as though they had worked, and
   * then announced by a terminal notice for a plan nobody is waiting for. A
   * phase already running is left alone; its children read the same signal
   * themselves (`runSubagent`). Mirrors the Rust driver, which stops when the
   * registry it dispatches into has been torn down. */
  signal?: AbortSignal
}

/** One finished child of a phase: what `runDispatchPlan` returns for the final
 * phase so the caller can compose the plan's single terminal ping. */
export type PlanChildOutcome = {
  name: string
  result: SubagentResult
  savedPath: string | null
}

/** A child produced something worth feeding forward and saving: not an error,
 * and not empty. The one predicate for "write it / inject it", so the blackboard
 * write and the next-phase injection can never drift apart. */
function hasRealAnswer(result: SubagentResult): boolean {
  return !result.isError && result.output.trim().length > 0
}

/**
 * The phase scheduler: run each phase's subagents concurrently, wait for the
 * whole phase, write every real answer to the blackboard AND keep it in memory,
 * then hand the next phase those results (via `injectInputs`). Port of the Rust
 * `spawn_dispatch_plan`/`run_phase_plan` driver.
 *
 * Resilient by construction: a failed child yields an error output and the plan
 * proceeds; this never throws (so the caller can release its plan-hold in a
 * `finally`). Each subagent is keyed `${callId}-${name}` for the store.
 *
 * A cancelled run (`cb.signal`) stops the plan where it stands: no later phase is
 * dispatched, no final phase is reported, and the caller rings no notice for it.
 *
 * Returns the final phase's outcomes so a multi-phase caller can ring the
 * doorbell once with a consolidated notice (see `planCompletionNotice`).
 */
export async function runDispatchPlan(
  plan: DispatchPlan,
  callId: string,
  cb: DispatchPlanCallbacks
): Promise<PlanChildOutcome[]> {
  let inputs: { name: string; output: string }[] = []
  let finalPhase: PlanChildOutcome[] = []
  for (const phase of plan.phases) {
    // The run is gone: the phases still ahead are dead work, and there is no
    // final phase to report. Returning nothing is what stops a caller from
    // announcing a plan that never finished. Checked before the first phase too,
    // so a plan dispatched into an already-cancelled run starts nothing at all.
    if (cb.signal?.aborted) return []
    const outcomes = await Promise.all(
      phase.subagents.map(async (req): Promise<PlanChildOutcome> => {
        const id = `${callId}-${req.name}`
        const description = injectInputs(req.description, inputs)
        cb.onDispatch(id, req.name)
        let result: SubagentResult
        try {
          result = await cb.runOne(req, description, id)
        } catch (e) {
          // `runSubagent` does not throw, so this is the driver itself failing;
          // the plan must still proceed rather than losing the later phases.
          result = {
            output: e instanceof Error ? e.message : String(e),
            usage: null,
            isError: true,
            sessionTokens: 0,
          }
        }
        // Only a real answer is written to the blackboard and fed forward: an
        // error message in the file the next phase reads would be
        // indistinguishable from an answer. (Rust writes the error there too;
        // Cowork keeps the coordination file answer-only.)
        const savedPath = hasRealAnswer(result)
          ? await cb.writeBlackboard(req.name, result.output)
          : null
        cb.onComplete(id, req.name, result, savedPath)
        return { name: req.name, result, savedPath }
      })
    )
    inputs = outcomes
      .filter((o) => hasRealAnswer(o.result))
      .map((o) => ({
        name: o.name,
        output: capRetainedAnswer(o.result.output),
      }))
    finalPhase = outcomes
  }
  return finalPhase
}

export const __testing = {
  Semaphore,
  SUBAGENT_SKILL_TOOLS,
  ephemeralSubagentPrompt,
}
