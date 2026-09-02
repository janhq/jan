/* eslint-disable @typescript-eslint/no-explicit-any */
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
 * so a child prefills on the parent's slot and evicts its KV prefix, which the
 * parent then re-prefills on its next step. Fixing it means a dedicated
 * subagent slot, which is part of the still-open slot-reservation decision.
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

/** The `task` result for a child that has just been started. */
export function dispatchedSubagentResult(
  name: string,
  callId: string,
  savedPath: string | null
): string {
  const where = savedPath
    ? `Its answer will be written to ${savedPath}; read that file once you are told it has landed.`
    : 'You will be given its answer as soon as it finishes.'
  return (
    `Subagent '${name}' started in the background (${callId}). ${where} ` +
    'Keep working rather than waiting for it.'
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

export type SubagentRequest = {
  subagent_name: string
  description: string
  system_prompt?: string
  allowed_tools?: string[]
}

export type ResolvedSubagent = {
  name: string
  systemPrompt: string
  /** `null` inherits the parent's toolset minus what is withheld. */
  allowedTools: string[] | null
  model: string | null
}

/** Reject a malformed `task` call rather than running an errand with no brief. */
export function parseSubagentRequest(input: unknown): SubagentRequest | string {
  const raw = (input ?? {}) as Partial<SubagentRequest>
  if (typeof raw.subagent_name !== 'string' || !raw.subagent_name.trim()) {
    return '`task` requires a non-empty `subagent_name`'
  }
  if (typeof raw.description !== 'string' || !raw.description.trim()) {
    return '`task` requires a `description`: the subagent cannot see this conversation, so state everything it needs'
  }
  const req: SubagentRequest = {
    subagent_name: raw.subagent_name,
    description: raw.description,
  }
  if (typeof raw.system_prompt === 'string' && raw.system_prompt.trim()) {
    req.system_prompt = raw.system_prompt
  }
  if (Array.isArray(raw.allowed_tools)) {
    req.allowed_tools = raw.allowed_tools.filter(
      (t): t is string => typeof t === 'string'
    )
  }
  return req
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
 * An unknown name is only an error when no inline `system_prompt` was supplied:
 * a one-off subagent is first-class, which is what keeps `task` useful before
 * anything is saved. Ported from `subagent.rs::resolve_dispatch`.
 */
export function resolveSubagent(
  req: SubagentRequest,
  definitions: SubagentDefinition[],
  parentTools: string[]
): ResolvedSubagent | { error: string } {
  const saved = definitions.find((d) => d.name === req.subagent_name)
  const narrowed = intersectAllowedTools(
    saved ? saved.allowed_tools : (req.allowed_tools ?? null),
    // An inline allowlist *is* the one-off's definition, so it is not also
    // applied as a call-site narrowing (that would compare it to itself).
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
  if (!req.system_prompt) {
    return {
      error:
        `unknown subagent '${req.subagent_name}': no saved definition. For a ` +
        'one-off, retry with a `system_prompt` describing its role.',
    }
  }
  return {
    name: req.subagent_name,
    systemPrompt: req.system_prompt,
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
    return result.toUIMessageStream({
      messageMetadata: ({ part }) => {
        if (part.type !== 'finish') return undefined
        const usage = (part as any).totalUsage
        return {
          usage: {
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            totalTokens: usage?.totalTokens,
          },
        }
      },
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
    const system = buildSubagentSystemPrompt(resolved.systemPrompt, {
      workspacePath: opts.system.workspacePath,
      readOnlyFolder: opts.system.readOnlyFolder,
      bashAvailable: opts.system.bashAvailable && 'bash' in tools,
      // Derived, not passed: the intersection above may have dropped them.
      webSearch: 'web_search' in tools,
      environment: opts.system.environment,
    })

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

export const __testing = { Semaphore, SUBAGENT_SKILL_TOOLS }
