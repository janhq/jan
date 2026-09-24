// The public surface of the JavaScript/TypeScript SDK, declared by hand over
// the generated wire types.
//
// `generated/rpc-types.d.ts` is regenerated from `protocol/rpc-schema.json`;
// everything here is the part the schema does not describe - the classes, the
// handler contract, and the responses the runtime sends (the artifact covers
// request params and events, so the responses are pinned by this package's
// tests against a real runtime instead).
//
// The implementation is `src/index.js`, in plain JavaScript, so a consumer
// needs no build step; `tsconfig.json` type-checks both against this file.

import type { EventTag, HostCapability, RpcMethod, RpcParams, StreamEvent } from './generated/rpc-types.js'

export type { EventTag, EventByTag, RpcMethod, RpcParams, StreamEvent } from './generated/rpc-types.js'
export { EVENT_TAGS, PROTOCOL_VERSION } from './generated/rpc-types.js'

/**
 * What the runtime answers `permission/respond` with. The schema types the
 * field as a string - the runtime matches on these three and refuses anything
 * else - so the union is declared here rather than generated.
 */
export type PermissionDecision = 'allow_once' | 'allow_always' | 'deny'

/** An image a host hands back: a file path, a data URL, or raw bytes. */
export type HostImage =
  | string
  | { path: string; mimeType?: string }
  | { url: string }
  | { data: string | Uint8Array; mimeType?: string }

/** What a host tool handler answers with. */
export type ToolResult =
  | string
  | {
      text?: string
      /** OpenAI content parts, passed through unchanged. */
      parts?: unknown[]
      content?: string | unknown[]
      images?: HostImage[]
      /** Host-only data, echoed as `item/tool_details` and never sent to the model. */
      details?: Record<string, unknown>
      isError?: boolean
      error?: string
    }

/** What a host tool handler is told about the call it is running. */
export interface HostToolCall {
  requestId: string
  /** The name the host declared, not the `host__`-prefixed name the model calls. */
  toolName: string
  /** The child that called it, or `null` for the main run. */
  runId: string | null
  session: JanSession
  /** Aborted when the runtime withdraws the request. */
  signal: AbortSignal
}

/** A host tool: what the model sees, plus the handler that runs it here. */
export interface HostTool {
  name: string
  description?: string
  /** JSON Schema for the arguments, advertised to the model verbatim. */
  parameters?: Record<string, unknown>
  /**
   * What the tool does, which decides how the loop treats it: `read` (a camera,
   * a sensor) is never prompted, is advertised in Plan mode and runs
   * concurrently; `actuator` is prompted even under `allow_always` unless the
   * host owns the gate, runs sequentially, and is withheld in Plan mode.
   */
  capability?: HostCapability
  handler: (args: unknown, call: HostToolCall) => ToolResult | Promise<ToolResult>
}

/** A method the runtime answered with a JSON-RPC error. */
export declare class JanRpcError extends Error {
  code?: number
  data?: unknown
  method?: string
  /** `true` for "another turn is active": the same request could succeed later. */
  get retryable(): boolean
}

/** The runtime process failed: spawn, handshake, protocol version, or exit. */
export declare class JanRuntimeError extends Error {
  exitCode?: number | null
  signal?: string | null
  stderr?: string
}

export interface JanRuntimeOptions {
  /** The runtime binary. Defaults to `$JAN_BIN`, then `jan` on `PATH`. */
  bin?: string
  /** Arguments after the binary. Defaults to `['cli', 'agent', 'rpc']`. */
  args?: string[]
  /** Working directory for the process, and the default for a session's `cwd`. */
  cwd?: string
  env?: Record<string, string | undefined>
  clientInfo?: { name: string; version: string }
  /** How long the handshake may take before `start()` rejects. */
  handshakeTimeoutMs?: number
  /** How long `close()` waits for a clean exit before killing. */
  shutdownGraceMs?: number
  /** Most events one undrained turn keeps before dropping its oldest. */
  maxBufferedEvents?: number
  onStderr?: (chunk: string) => void
}

/** The caps a content-part array is held to, as the runtime advertises them. */
export interface ContentPartLimits {
  mime_types: string[]
  max_image_bytes: number
  max_message_image_bytes: number
  max_images: number
  max_line_bytes: number
  max_echo_bytes: number
}

export interface CreateSessionOptions {
  cwd?: string
  model?: string
  /** Keep nothing on disk: no thread, no media files. */
  ephemeral?: boolean
  /** `false` advertises only the host tools, no built-ins or MCP. */
  builtins?: boolean
  /**
   * Who gates a host tool call. `'host'` when this process runs and gates its
   * own tools, so the runtime never prompts for them. `'jan'` (the default)
   * leaves the gate with the runtime: an `actuator` call raises
   * `permission_request` and the turn waits until `respondPermission` answers
   * it.
   */
  permissions?: 'jan' | 'host'
  tools?: HostTool[]
}

/** A session as the runtime reports it in `session/list`. */
export interface SessionSummary {
  id: string
  model: string
  turns: number
  hostTools: number
}

export interface ToolSetView {
  tools: string[]
  toolSpecs: Record<string, unknown>[]
}

/**
 * What each method answers with.
 *
 * `protocol/rpc-schema.json` describes request params and events, not
 * responses, so these are declared here and pinned by this package's tests
 * against a real runtime - a shape that moves fails there rather than in a
 * consumer's code.
 *
 * `null` is this file's way of saying the runtime answers `{}`: the verb has no
 * value to read, and the field says so rather than making a caller destructure
 * nothing.
 */
export interface RpcResponses {
  initialize: {
    protocolVersion: number
    serverInfo: { name: string; version: string }
    capabilities: Record<string, unknown>
    /** Absent on a runtime older than the caps. */
    input_content_parts?: ContentPartLimits
  }
  'session/list': { sessions: SessionSummary[] }
  'session/start': ToolSetView & { sessionId: string; model: string }
  'session/resume': { sessionId: string; model: string; turns: number }
  'session/fork': { sessionId: string }
  'session/archive': null
  'turn/start': { turnId: string }
  'turn/steer': null
  'turn/interrupt': null
  'permission/respond': null
  'tool/respond': null
  'session/tools/get': ToolSetView
  'session/tools/set': ToolSetView
  'session/model/set': { model: string }
  'session/reset': null
}

/** One turn of a session: what `prompt()` returns. */
export declare class JanTurn implements AsyncIterable<StreamEvent> {
  readonly session: JanSession
  readonly id: string
  /** Events dropped because nobody drained this turn, oldest first. */
  readonly dropped: number
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent>
  /** `{ stopReason, usage, error }`, once the runtime closes the turn. */
  result(): Promise<{ stopReason: string; usage?: unknown; error?: string | null }>
  /** Stop this turn; it still settles, with `stopReason: "interrupted"`. */
  interrupt(): Promise<null>
}

/** A session on a runtime. */
export declare class JanSession {
  readonly runtime: JanRuntime
  readonly id: string
  model: string | null
  /** The names the runtime advertises, as it reports them: the declared ones
   * with their `host__` prefix, which is what the model calls. */
  tools: string[]
  toolSpecs: Record<string, unknown>[]
  readonly maxBufferedEvents: number
  on(kind: EventTag | 'event' | '*', listener: (event: StreamEvent) => void): () => void
  prompt(input: string | unknown[] | { text: string } | { content: unknown[] }): Promise<JanTurn>
  steer(input: string | { text: string }): Promise<null>
  interrupt(): Promise<null>
  reset(): Promise<null>
  getTools(): Promise<ToolSetView>
  setTools(tools: HostTool[]): Promise<ToolSetView>
  setModel(model: string): Promise<string>
  fork(options?: { tools?: HostTool[] }): Promise<JanSession>
  archive(): Promise<void>
  respondPermission(requestId: string, decision: PermissionDecision): Promise<null>
}

/** A Jan runtime process, spawned and owned by this object. */
export declare class JanRuntime {
  static start(options?: JanRuntimeOptions): Promise<JanRuntime>
  readonly cwd?: string
  readonly maxBufferedEvents: number
  readonly protocolVersion: number | null
  readonly serverInfo: { name: string; version: string } | null
  readonly capabilities: Record<string, unknown> | null
  /** `null` when the runtime is too old to advertise the caps. */
  readonly limits: ContentPartLimits | null
  readonly pid?: number
  readonly stderr: string
  on(kind: 'exit' | 'event' | 'notification', listener: (payload: unknown) => void): () => void
  createSession(options?: CreateSessionOptions): Promise<JanSession>
  listSessions(): Promise<SessionSummary[]>
  resumeSession(sessionId: string): Promise<JanSession>
  forkSession(sessionId: string, options?: { tools?: HostTool[] }): Promise<JanSession>
  request<M extends RpcMethod>(method: M, params?: RpcParams<M>, options?: { timeoutMs?: number }): Promise<RpcResponses[M]>
  close(options?: { force?: boolean }): Promise<{ code: number | null; signal: string | null }>
}
