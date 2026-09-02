/**
 * Shared Cowork session types, kept free of any store so the presentation layer
 * can be built and tested without pulling in zustand or the run driver.
 *
 * The shapes mirroring Rust structs keep snake_case field names verbatim: the
 * same JSON crosses the tool boundary in both directions, and renaming here
 * would mean a translation layer on every hop.
 */

/** A single visible transcript entry. `tool` rows are display-only and carry the
 * structured call/result so the UI can render a tool card.
 *
 * `system` rows are the out-of-band notes the run folds into the conversation
 * -- today, a backgrounded subagent reporting that it finished. They are shown
 * because they change what the agent does next, and reading a turn that reacts
 * to one is otherwise reading half a conversation. */
export type CoworkTurn = {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  /** Assistant-row only: natively streamed reasoning (`reasoning-*` chunks),
   * kept beside the answer rather than inline in it -- `content` is what goes
   * back as wire history, and reasoning must not ride there as text. Inline
   * `<think>` reasoning stays inside `content` (that is what the model sent)
   * and is split out at render time instead. */
  reasoning?: string
  /** User-row only: images/audio/video attached to the question, as the
   * `file` parts the model received. */
  media?: CoworkMediaPart[]
  /** User-row only: documents attached to the question. */
  files?: CoworkAttachedFile[]
  callId?: string
  name?: string
  args?: unknown
  /** Raw JSON argument text accumulated while the call streams, so the tool card
   * shows a live preview. Superseded once the parsed `args` land. */
  argsLive?: string
  result?: string
  isError?: boolean
  diff?: string
  status?: 'running' | 'done'
}

/** A pasted or picked image/audio/video, shaped as an AI SDK `file` part. */
export type CoworkMediaPart = {
  type: 'file'
  mediaType: string
  url: string
}

/** A document the user attached to a question. `path` is where it was picked
 * from; the session does not copy it. */
export type CoworkAttachedFile = {
  name: string
  path: string
  fileType?: string
  size?: number
  /** The copy inside the session workspace, once imported for the agent. */
  workspacePath?: string
  /** Extracted text written beside the copy, for formats `read` cannot open. */
  textPath?: string
}

/** Mirrors the Rust `Usage` struct (events.rs). */
export type Usage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

/**
 * One subagent run, bucketed by its own run id so concurrent subagents never
 * share a transcript lane. Lives transiently in the run store while running,
 * then the finished set is committed onto its session.
 */
export type SubagentRun = {
  runId: string
  name: string
  status: 'queued' | 'running' | 'done'
  startedAt: number
  endedAt?: number
  /** 1-based FIFO queue position while `queued`; cleared on start. */
  waiting?: number
  /** The subagent's own trace. The final answer is in `finalOutput`, not here. */
  turns: CoworkTurn[]
  finalOutput?: string
  usage?: Usage
}

/** Mirrors the Rust `TodoItem`/`TodoPhase`/`TodoList` structs (todo.rs). */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned'

export type TodoItem = {
  content: string
  status: TodoStatus
}

export type TodoPhase = {
  name: string
  tasks: TodoItem[]
}

export type TodoList = {
  phases: TodoPhase[]
}

/** `/goal` state: set by `/goal <condition>`, checked after each turn completes,
 * cleared by `/goal clear` or once the evaluator reports it met. */
export type CoworkGoal = {
  condition: string
  turns: number
  status: 'active' | 'achieved'
  lastReason: string
}

/** Mirrors the Rust `OptionItem`/`Question`/`AskRequest` structs (interaction.rs). */
export type AskOption = {
  label: string
  description?: string
}

export type AskQuestion = {
  id: string
  question: string
  options: AskOption[]
  multi?: boolean
  recommended?: number
}

export type AskRequestPayload = {
  questions: AskQuestion[]
}

/** Mirrors `QuestionResult` (interaction.rs): one answer per question, either
 * selected option label(s) or free-text `custom_input` — never both. */
export type AskAnswer = {
  id: string
  selected: string[]
  custom_input?: string
}
