// JavaScript/TypeScript client for the Jan agent runtime.
//
// One long-lived `jan cli agent rpc` process serves many addressable sessions
// over LF-delimited JSON-RPC; this module is the client half of that channel -
// the handshake, the session and turn lifecycle, streamed events, and the host
// tools the caller's own process runs.
//
// Types come from `protocol/rpc-schema.json` via `scripts/generate.mjs`, so a
// verb cannot change without this package's types moving with it. The runtime
// is spawned and owned: a crash, an EOF or a shutdown settles every parked
// turn and tool call rather than hanging, and the process is reaped.
//
// See `README.md` for the quickstart and the host-tool contract.

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { extname } from 'node:path'
import { createInterface } from 'node:readline'

import { EVENT_TAGS, PROTOCOL_VERSION } from './generated/rpc-types.js'

// Fetching the runtime this client spawns is its own concern - the manifest, the
// digest, the platform table - so it lives in its own module and is re-exported
// here as the package's one entry point.
export {
  JanInstallError,
  MANIFEST_URL,
  PLATFORM_KEYS,
  binName,
  findRuntime,
  installRuntime,
  platformKey,
  runtimeRoot,
} from './install.js'

const require = createRequire(import.meta.url)
const { version: ADK_VERSION } = require('../package.json')

const CLIENT_NAME = '@janhq/adk'

// The types a host may hand back as an image without naming one. The runtime
// enforces the same set (and the byte caps) on arrival; this is only what the
// ADK can name from a file path.
const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

// A method the runtime answered with a JSON-RPC error. `code` is the
// protocol's: `-32602` for malformed params, `-32001` while another turn is
// active, `-32002` before the handshake, `-32601` for a method this runtime
// does not have.
export class JanRpcError extends Error {
  constructor(message, { code, data, method } = {}) {
    super(message)
    this.name = 'JanRpcError'
    this.code = code
    this.data = data
    this.method = method
  }

  // Whether retrying the same request could succeed: the runtime says so for
  // "another turn is active", and this is where that answer is readable.
  get retryable() {
    return this.data?.retryable === true
  }
}

// The runtime process failed: it could not be spawned, it did not complete the
// handshake, it is not the protocol version this client speaks, or it exited.
// Distinct from [`JanRpcError`] on purpose - one is an answer, this is the
// channel.
export class JanRuntimeError extends Error {
  constructor(message, { exitCode, signal, stderr } = {}) {
    super(message)
    this.name = 'JanRuntimeError'
    this.exitCode = exitCode
    this.signal = signal
    this.stderr = stderr
  }
}

// An event queue one consumer reads. `push` reports whether the event was
// taken immediately or buffered, which is what lets a turn nobody is draining
// stay bounded.
class EventQueue {
  #items = [];
  #waiters = [];
  #ended = false;
  #failure = null;

  get length() {
    return this.#items.length
  }

  // `true` when the event had to be buffered because no reader was waiting.
  push(item) {
    if (this.#ended) return false
    const waiter = this.#waiters.shift()
    if (waiter) {
      waiter({ value: item, done: false })
      return false
    }
    this.#items.push(item)
    return true
  }

  // Drop the oldest buffered event, reporting whether there was one.
  dropOldest() {
    return this.#items.shift() !== undefined
  }

  end() {
    if (this.#ended) return
    this.#ended = true
    for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined, done: true })
  }

  fail(error) {
    if (this.#ended) return
    this.#failure = error
    this.#ended = true
    for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined, done: true })
  }

  next() {
    const waiter = this.#waiters.shift()
    if (waiter) return waiter
    if (this.#items.length) return Promise.resolve({ value: this.#items.shift(), done: false })
    if (this.#failure) return Promise.reject(this.#failure)
    if (this.#ended) return Promise.resolve({ value: undefined, done: true })
    return new Promise((resolve) => this.#waiters.push(resolve))
  }

  [Symbol.asyncIterator]() {
    return this
  }
}

// One turn of a session: what `session.prompt()` returns.
///
// Iterate it for the events as they stream, and await `result()` for the
// terminal record. Both are safe in any order and more than once; events are
// buffered until read.
export class JanTurn {
  constructor(session, id) {
    this.session = session
    this.id = id
    // Events dropped because nobody was draining this turn, oldest first. The
    // assembled records and the terminal one are what a late reader needs, and
    // those are the last to go.
    this.dropped = 0
    this.#queue = new EventQueue()
    this.#terminal = new Promise((resolve, reject) => {
      this.#settle = resolve
      this.#reject = reject
    })
    // A turn can fail before its caller reaches `result()` - `close()` does
    // exactly that - and an unhandled rejection in that gap is a crash in a
    // caller's process rather than a value it can await. Marking it handled
    // here does not consume it: `result()` still rejects.
    this.#terminal.catch(() => {})
  }

  #queue;
  #settle;
  #reject;
  #terminal;

  // The events of this turn, in the order the runtime emitted them.
  [Symbol.asyncIterator]() {
    return this.#queue[Symbol.asyncIterator]()
  }

  // `{ stopReason, usage, error }`. Resolves when the runtime closes the turn;
  // rejects when the channel dies first, because a turn with no terminal
  // record has no outcome to report.
  result() {
    return this.#terminal
  }

  // Ask the runtime to stop this turn. The turn still settles - with
  // `stopReason: "interrupted"` - so `result()` is awaited exactly as usual.
  interrupt() {
    return this.session.interrupt()
  }

  // Called by the session. A turn nobody reads keeps at most the session's
  // `maxBufferedEvents`, then loses its oldest events - a run that streams
  // tokens into an unread turn must not grow the client without limit.
  _push(event) {
    this.#queue.push(event)
    // The cap is on what is still unread, not on the turn's own output: a
    // reader that keeps up takes events out, so the queue's depth is the
    // buffer. A running total would start dropping events a reader never
    // missed the moment the turn had emitted more than the cap in total.
    while (this.#queue.length > this.session.maxBufferedEvents) {
      if (!this.#queue.dropOldest()) return
      this.dropped += 1
    }
  }

  _finish(record) {
    this.#queue.end()
    this.#settle(record)
  }

  _fail(error) {
    this.#queue.fail(error)
    this.#reject(error)
  }
}

// A session on a runtime: a conversation, its model, and its host tools.
export class JanSession {
  constructor(runtime, { id, model, tools, toolSpecs }) {
    this.runtime = runtime
    this.id = id
    this.model = model
    // The host tool names the runtime advertises, as it reports them.
    this.tools = tools
    // Their schemas, as the runtime advertises them.
    this.toolSpecs = toolSpecs
    // Most events one undrained turn keeps; set on the runtime.
    this.maxBufferedEvents = runtime.maxBufferedEvents
    this.#turns = new Map()
    this.#decls = new Map()
    this.#listeners = new Map()
  }

  #turns;
  #decls;
  #listeners;
  #calls = new Map();
  #late = new Map();
  #closed = false;

  // Every event the session reports, including the ones raised by a subagent,
  // which arrive wrapped in a `subagent` event.
  //
  // `kind` is `'event'` for the stream as a whole, `'*'` for everything the
  // session reports, or an event tag such as `'token'`, `'tool_request'` or
  // `'permission_request'`: `on('tool_request', fn)` observes host tool calls,
  // which the declaration's `handler` answers either way. A tag is a second
  // name for an event already on the stream, so `'*'` hears each event once.
  on(kind, listener) {
    const list = this.#listeners.get(kind) ?? []
    list.push(listener)
    this.#listeners.set(kind, list)
    return () => this.#listeners.set(kind, (this.#listeners.get(kind) ?? []).filter((entry) => entry !== listener))
  }

  // Start a turn and stream it. `input` is a string, or content parts, for the
  // images a vision model needs: `[{ type: 'text', text }, { type: 'image_url',
  // image_url: { url: 'data:image/png;base64,...' } }]`.
  async prompt(input) {
    const { turnId } = await this.runtime.request('turn/start', {
      sessionId: this.id,
      input: normalizeInput(input),
    })
    return this.#turn(turnId, true)
  }

  // Steer the active turn: the message joins the run it is already in, rather
  // than queueing behind it.
  steer(input) {
    return this.runtime.request('turn/steer', {
      sessionId: this.id,
      input: extractText(input),
    })
  }

  // Stop the active turn. It settles with `stopReason: "interrupted"`, and its
  // outstanding host tool calls are withdrawn.
  interrupt() {
    return this.runtime.request('turn/interrupt', { sessionId: this.id })
  }

  // Clear the history, keeping the model and the tool set.
  reset() {
    return this.runtime.request('session/reset', { sessionId: this.id })
  }

  // The tool set the runtime currently advertises, read back from it rather
  // than assumed: `{ tools, toolSpecs }`.
  getTools() {
    return this.runtime.request('session/tools/get', { sessionId: this.id })
  }

  // Replace the host tools of a session between turns. Refused while a turn is
  // active (`JanRpcError.code === -32001`).
  async setTools(tools) {
    const view = await this.runtime.request('session/tools/set', {
      sessionId: this.id,
      tools: tools.map(toDeclaration),
    })
    this._declare(tools)
    this.tools = view.tools
    this.toolSpecs = view.toolSpecs
    return view
  }

  // Change the model between turns. Refused while a turn is active.
  async setModel(model) {
    const { model: current } = await this.runtime.request('session/model/set', {
      sessionId: this.id,
      model,
    })
    this.model = current
    return current
  }

  // A new session with this one's history, addressable on its own. Its host
  // tools are not inherited - a declaration belongs to the session that made
  // it - so `fork({ tools })` re-declares them.
  fork({ tools = [] } = {}) {
    return this.runtime.forkSession(this.id, { tools })
  }

  // Drop the session from the runtime. Turns already finished are unaffected;
  // a turn still running is closed by the runtime first.
  async archive() {
    await this.runtime.request('session/archive', { sessionId: this.id })
    this.runtime._release(this)
    this.#closed = true
    this.#abort(new JanRuntimeError('the session was archived'))
    this.#listeners.clear()
  }

  // Answer a permission request. `decision` is `allow_once`, `allow_always` or
  // `deny`. A session started with `permissions: 'host'` is not prompted for
  // its host tools at all; this is for the built-ins the runtime still gates.
  respondPermission(requestId, decision) {
    return this.runtime.request('permission/respond', { requestId, decision })
  }

  // Attach the handlers a session's declarations carry. Called by the runtime
  // when the session is created, and by `setTools` when they are replaced.
  _declare(tools) {
    this.#decls = new Map(tools.map((tool) => [tool.name, tool]))
  }

  // Called by the runtime on every frame addressed to this session.
  _deliver(tag, { turnId, event }) {
    this.#emit('event', event)
    // By tag as well, so `on('tool_request')` and `on('permission_request')`
    // hear what they were told they would.
    this.#notify(tag, event)
    const turn = this.#turn(turnId, true)
    turn?._push(event)
    if (tag === 'tool_request') this.#answer(event)
    else if (tag === 'tool_request_cancelled') this.#abandon(event)
  }

  _complete({ turnId, stopReason, error }) {
    const record = { stopReason, error: error ?? null }
    const turn = this.#turns.get(turnId)
    // The runtime may close a turn it started before the client asked for it -
    // a run that ends with no events, or an immediate refusal. The record is
    // held so `prompt()` finds it on the turn it is about to return, rather
    // than a turn that never finishes.
    if (!turn) {
      this.#late.set(turnId, record)
      if (this.#late.size > 64) this.#late.delete(this.#late.keys().next().value)
      return
    }
    this.#turns.delete(turnId)
    turn._finish(record)
  }

  // The runtime is gone: every open turn fails rather than hangs.
  _fail(error) {
    for (const turn of this.#turns.values()) turn._fail(error)
    this.#turns.clear()
    this.#abort(error)
  }

  #turn(turnId, create = false) {
    if (!turnId) return null
    const existing = this.#turns.get(turnId)
    if (existing) return existing
    if (!create) return null
    const turn = new JanTurn(this, turnId)
    this.#turns.set(turnId, turn)
    const late = this.#late.get(turnId)
    if (late) {
      this.#late.delete(turnId)
      this.#turns.delete(turnId)
      turn._finish(late)
    }
    return turn
  }

  // One emission, to the listeners of that kind and to `'*'`, which hears
  // everything once.
  #emit(kind, event) {
    this.#notify(kind, event)
    this.#notify('*', event)
  }

  // Without the `'*'` fan-out, for a second tag on an event already emitted:
  // a tag listener hears it, and `'*'` does not hear it twice.
  #notify(kind, event) {
    for (const listener of this.#listeners.get(kind) ?? []) listener(event)
  }

  // A host tool was called. The handler runs without holding the reader: two
  // children may have calls in flight at once, and serializing them is the
  // host's decision - its own queue, its own capability tokens - rather than
  // this client's.
  #answer(event) {
    if (this.#closed) return
    const declaration = this.#decls.get(event.tool_name)
    const controller = new AbortController()
    this.#calls.set(event.request_id, controller)
    const answer = async () => {
      if (!declaration) {
        await this.#respond(event.request_id, {
          content: `no host tool named '${event.tool_name}' is declared on this session`,
          isError: true,
        })
        return
      }
      let result
      try {
        result = await declaration.handler(event.args, {
          requestId: event.request_id,
          toolName: event.tool_name,
          runId: event.run_id ?? null,
          session: this,
          signal: controller.signal,
        })
      } catch (error) {
        await this.#respond(event.request_id, {
          content: error instanceof Error ? error.message : String(error),
          isError: true,
        })
        return
      }
      await this.#respond(event.request_id, await normalizeResult(result))
    }
    answer().catch(() => {})
  }

  // The runtime withdrew a request: a late answer is refused as not pending,
  // so the handler is aborted and nothing is written.
  #abandon({ request_id }) {
    this.#calls.get(request_id)?.abort()
    this.#calls.delete(request_id)
  }

  async #respond(requestId, params) {
    const controller = this.#calls.get(requestId)
    if (!controller || controller.signal.aborted) {
      this.#calls.delete(requestId)
      return
    }
    this.#calls.delete(requestId)
    try {
      await this.runtime.request('tool/respond', { requestId, ...params })
    } catch {
      // The turn was interrupted or the channel closed: the request is already
      // withdrawn, and there is no one left to tell.
    }
  }

  #abort(error) {
    for (const controller of this.#calls.values()) controller.abort(error)
    this.#calls.clear()
  }
}

// A Jan runtime process, spawned and owned by this object.
///
// `await JanRuntime.start()` resolves once the handshake is done, so a runtime
// that cannot speak this protocol version fails before any work starts rather
// than mid-turn.
export class JanRuntime {
  #child;
  #stdin;
  #reading;
  #exited;
  #bin;
  #handshakeTimeoutMs;
  #shutdownGraceMs;
  #clientInfo;
  #stderr = '';
  #pending = new Map();
  #nextId = 1;
  #sessions = new Map();
  #listeners = new Map();
  #closing = false;
  #failure = null;
  #protocolVersion = null;
  #serverInfo = null;
  #capabilities = null;
  #limits = null;

  constructor(options = {}) {
    const {
      bin = process.env.JAN_BIN ?? 'jan',
      args = ['cli', 'agent', 'rpc'],
      cwd,
      env,
      clientInfo = { name: CLIENT_NAME, version: ADK_VERSION },
      handshakeTimeoutMs = 20_000,
      shutdownGraceMs = 5_000,
      maxBufferedEvents = 100_000,
      onStderr,
    } = options

    this.cwd = cwd
    this.maxBufferedEvents = maxBufferedEvents
    this.#bin = bin
    this.#handshakeTimeoutMs = handshakeTimeoutMs
    this.#shutdownGraceMs = shutdownGraceMs
    this.#clientInfo = clientInfo

    const child = spawn(bin, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // The ADK owns this process and its lifetime; an update check nobody
        // asked for is a network call inside a caller's turn.
        JAN_CLI_NO_UPDATE_CHECK: '1',
        ...env,
      },
    })
    this.#child = child
    this.#stdin = child.stdin

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      // Kept for the failure message and for a caller that wants the runtime's
      // own logging; a runtime that dies mid-turn is otherwise unexplainable.
      this.#stderr = (this.#stderr + chunk).slice(-8192)
      if (onStderr) onStderr(chunk)
    })

    this.#reading = createInterface({ input: child.stdout, crlfDelay: Infinity })
    this.#reading.on('line', (line) => this.#onLine(line))

    this.#exited = new Promise((resolve) => {
      child.once('error', (error) => {
        this.#fail(new JanRuntimeError(`could not start '${bin}': ${error.message}`, { stderr: this.#stderr }))
        resolve({ code: null, signal: null })
      })
      child.once('exit', (code, signal) => {
        this.#fail(
          new JanRuntimeError(
            `the jan runtime exited with ${signal ? `signal ${signal}` : `code ${code}`}${this.#stderr ? `: ${this.#stderr.trim()}` : ''}`,
            { exitCode: code, signal, stderr: this.#stderr },
          ),
        )
        this.#emit('exit', { code, signal })
        resolve({ code, signal })
      })
    })
  }

  // Spawn a runtime and complete the handshake: `initialize`, then the
  // `initialized` notification every other method sits behind.
  static async start(options = {}) {
    const runtime = new JanRuntime(options)
    await runtime.#handshake()
    return runtime
  }

  // The version the runtime answered with. Equal to the version this client
  // speaks, or `start()` would have thrown.
  get protocolVersion() {
    return this.#protocolVersion
  }

  // `{ name, version }` of the runtime binary.
  get serverInfo() {
    return this.#serverInfo
  }

  // What the runtime says it supports: `{ session, turn }`.
  get capabilities() {
    return this.#capabilities
  }

  // The caps a content-part array is held to - a `prompt()` with images and a
  // host tool's answer alike: `{ mime_types, max_image_bytes,
  // max_message_image_bytes, max_images, max_line_bytes, max_echo_bytes }`.
  // `null` when the runtime is too old to advertise them.
  get limits() {
    return this.#limits
  }

  get pid() {
    return this.#child.pid
  }

  // The runtime's own stderr so far.
  get stderr() {
    return this.#stderr
  }

  // Notifications this client does not route: `exit`, and any frame whose
  // method it does not know, so a newer runtime's additions are observable
  // rather than lost.
  on(kind, listener) {
    const list = this.#listeners.get(kind) ?? []
    list.push(listener)
    this.#listeners.set(kind, list)
    return () => this.#listeners.set(kind, (this.#listeners.get(kind) ?? []).filter((entry) => entry !== listener))
  }

  // Start a session. `tools` are host tools this session may call: each
  // declares what it does (`capability: 'read'` for a sensor, `'actuator'` for
  // something that moves) and carries the `handler` that runs it here.
  async createSession({ cwd, model, ephemeral, builtins, permissions = 'jan', tools = [] } = {}) {
    const params = { cwd: cwd ?? this.cwd ?? process.cwd() }
    if (model !== undefined) params.model = model
    if (ephemeral !== undefined) params.ephemeral = ephemeral
    if (builtins !== undefined) params.builtins = builtins
    if (permissions !== 'jan') params.permissions = permissions
    if (tools.length) params.tools = tools.map(toDeclaration)
    const view = await this.request('session/start', params)
    const session = this.#session(view)
    if (tools.length) session._declare(tools)
    return session
  }

  // Sessions this process is serving, as the runtime sees them.
  async listSessions() {
    const { sessions } = await this.request('session/list', {})
    return sessions
  }

  // Reopen a session of this process from its id. Host tools are not
  // inherited: re-declare them with `session.setTools`.
  async resumeSession(sessionId) {
    return this.#session(await this.request('session/resume', { sessionId }))
  }

  // A new session with another session's history.
  async forkSession(sessionId, { tools = [] } = {}) {
    const source = this.#sessions.get(sessionId)
    const { sessionId: forked } = await this.request('session/fork', { sessionId })
    const view = await this.request('session/tools/get', { sessionId: forked })
    // The tools view carries the tools and nothing else: the id and the model
    // have to come from the fork itself and from the session it was forked
    // from, which the runtime rebuilt it from.
    const session = this.#session({ ...view, sessionId: forked, model: source?.model ?? null })
    if (tools.length) await session.setTools(tools)
    return session
  }

  // One JSON-RPC request, answered or refused. The escape hatch for a verb
  // this client has no wrapper for.
  request(method, params = {}, { timeoutMs } = {}) {
    if (this.#failure) return Promise.reject(this.#failure)
    if (this.#closing) return Promise.reject(new JanRuntimeError('the runtime is closing'))
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      const entry = { method, resolve, reject, timer: null }
      if (timeoutMs) {
        entry.timer = setTimeout(() => {
          this.#pending.delete(id)
          reject(new JanRuntimeError(`'${method}' was not answered within ${timeoutMs}ms`))
        }, timeoutMs)
      }
      this.#pending.set(id, entry)
      this.#write({ jsonrpc: '2.0', id, method, params }).catch((error) => {
        const current = this.#pending.get(id)
        this.#pending.delete(id)
        clearTimeout(current?.timer)
        current?.reject(error)
      })
    })
  }

  // Close the channel, then the process: closing stdin is the runtime's own
  // shutdown signal, and a turn still running when it arrives is closed with
  // `stopReason: "interrupted"` before the process exits. `force` skips the
  // grace period and kills.
  async close({ force = false } = {}) {
    if (this.#closing) return this.#exited
    this.#closing = true
    const gone = new JanRuntimeError('the runtime was closed')
    for (const session of this.#sessions.values()) session._fail(gone)
    this.#sessions.clear()
    if (!this.#stdin.destroyed) this.#stdin.end()
    if (force) {
      this.#child.kill('SIGKILL')
      return this.#exited
    }
    const timer = setTimeout(() => this.#child.kill('SIGKILL'), this.#shutdownGraceMs)
    try {
      return await this.#exited
    } finally {
      clearTimeout(timer)
    }
  }

  async #handshake() {
    let result
    try {
      result = await this.request(
        'initialize',
        { protocolVersion: PROTOCOL_VERSION, clientInfo: this.#clientInfo, capabilities: {} },
        { timeoutMs: this.#handshakeTimeoutMs },
      )
    } catch (error) {
      await this.#killQuietly()
      if (error instanceof JanRpcError) {
        throw new JanRuntimeError(
          `'${this.#bin}' refused the handshake: ${error.message}${this.#stderr ? `: ${this.#stderr.trim()}` : ''}`,
          { stderr: this.#stderr },
        )
      }
      throw error
    }
    if (result?.protocolVersion !== PROTOCOL_VERSION) {
      await this.#killQuietly()
      throw new JanRuntimeError(
        `the runtime speaks protocol version ${result?.protocolVersion}, this client speaks ${PROTOCOL_VERSION}`,
        { stderr: this.#stderr },
      )
    }
    this.#protocolVersion = result.protocolVersion
    this.#serverInfo = result.serverInfo ?? null
    this.#capabilities = result.capabilities ?? null
    this.#limits = result.input_content_parts ?? null
    this.#write({ jsonrpc: '2.0', method: 'initialized', params: {} }).catch(() => {})
  }

  async #killQuietly() {
    this.#closing = true
    if (!this.#stdin.destroyed) this.#stdin.end()
    this.#child.kill('SIGKILL')
    await this.#exited
  }

  #session(view) {
    const session = new JanSession(this, {
      id: view.sessionId,
      model: view.model ?? null,
      tools: view.tools ?? [],
      toolSpecs: view.toolSpecs ?? [],
    })
    this.#sessions.set(session.id, session)
    return session
  }

  // Called by a session that was archived: the runtime no longer knows it.
  _release(session) {
    this.#sessions.delete(session.id)
  }

  // The runtime's own frame, routed. Everything that is not an answer or a
  // session event ends up on the `notification` listener.
  #onLine(line) {
    if (!line.trim()) return
    let frame
    try {
      frame = JSON.parse(line)
    } catch {
      this.#fail(
        new JanRuntimeError(`the runtime wrote a line that is not JSON: ${line.slice(0, 200)}`, {
          stderr: this.#stderr,
        }),
      )
      return
    }
    if (frame.method === undefined) {
      this.#settle(frame.id, frame)
      return
    }
    const method = frame.method
    const params = frame.params ?? {}
    if (method.startsWith('item/')) {
      const session = this.#sessions.get(params.sessionId)
      if (session) session._deliver(method.slice('item/'.length), params)
      else this.#emit('event', { ...params, tag: method.slice('item/'.length) })
      return
    }
    if (method === 'turn/completed') {
      this.#sessions.get(params.sessionId)?._complete(params)
      return
    }
    this.#emit('notification', frame)
  }

  #settle(id, frame) {
    const entry = this.#pending.get(id)
    if (!entry) return
    this.#pending.delete(id)
    clearTimeout(entry.timer)
    if (frame.error) {
      const { code, message, data } = frame.error
      entry.reject(new JanRpcError(message ?? 'the runtime refused the request', { code, data, method: entry.method }))
      return
    }
    entry.resolve(frame.result ?? null)
  }

  #write(frame) {
    if (this.#stdin.destroyed || !this.#stdin.writable) {
      return Promise.reject(new JanRuntimeError('the runtime channel is closed', { stderr: this.#stderr }))
    }
    return new Promise((resolve, reject) => {
      this.#stdin.write(`${JSON.stringify(frame)}\n`, (error) => (error ? reject(error) : resolve()))
    })
  }

  #emit(kind, payload) {
    for (const listener of this.#listeners.get(kind) ?? []) listener(payload)
  }

  #fail(error) {
    if (this.#failure) return
    this.#failure = error
    for (const entry of this.#pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.#pending.clear()
    for (const session of this.#sessions.values()) session._fail(error)
    this.#sessions.clear()
  }
}

// A host tool declaration: what the model sees, minus the handler, which never
// crosses the process boundary.
function toDeclaration(tool) {
  if (!tool || typeof tool !== 'object') throw new TypeError('a host tool must be an object')
  const { name, description, parameters, capability, handler } = tool
  if (typeof name !== 'string' || !name) throw new TypeError('a host tool needs a name')
  if (typeof handler !== 'function') throw new TypeError(`host tool '${name}' needs a handler`)
  const declaration = { name }
  if (description !== undefined) declaration.description = description
  if (parameters !== undefined) declaration.parameters = parameters
  if (capability !== undefined) declaration.capability = capability
  return declaration
}

// `turn/start` takes the text, the parts, or the record a client would write
// to a stream-json `user` line. All three are accepted here, normalized to the
// shape the parser already handles.
function normalizeInput(input) {
  if (typeof input === 'string') return input
  if (Array.isArray(input)) return { type: 'user', content: input }
  if (input && typeof input === 'object') {
    if (typeof input.text === 'string') return input.text
    if (Array.isArray(input.content)) return { type: 'user', content: input.content }
  }
  throw new TypeError('prompt() takes a string, content parts, or a { text } / { content } record')
}

function extractText(input) {
  if (typeof input === 'string') return input
  if (input && typeof input === 'object' && typeof input.text === 'string') return input.text
  throw new TypeError('steer() takes a string or a { text } record')
}

// What a handler returned, as the `tool/respond` the runtime parses: text,
// content parts, host-only details, and an image as a file path, a buffer or a
// data URL. A result that cannot be shaped is still answered - the model is
// never left parked on a call this client failed to format.
async function normalizeResult(result) {
  if (result === undefined || result === null) return { content: '' }
  if (typeof result === 'string') return { content: result }
  if (typeof result !== 'object') return { content: String(result) }
  if (result.isError === true || typeof result.error === 'string') {
    return {
      content: typeof result.error === 'string' ? result.error : String(result.content ?? ''),
      isError: true,
    }
  }
  const parts = []
  const text = result.text ?? (typeof result.content === 'string' ? result.content : undefined)
  if (text) parts.push({ type: 'text', text: String(text) })
  if (Array.isArray(result.parts)) parts.push(...result.parts)
  else if (Array.isArray(result.content)) parts.push(...result.content)
  for (const image of result.images ?? []) parts.push(await toImagePart(image))
  const response = { content: parts.length ? parts : String(text ?? '') }
  if (result.details !== undefined) {
    // `details` is host-only data echoed back in `tool_details`; the runtime
    // takes an object of values, so anything else is carried as one.
    response.details = isPlainObject(result.details) ? result.details : { value: result.details }
  }
  return response
}

async function toImagePart(image) {
  if (typeof image === 'string') {
    return { type: 'image_url', image_url: { url: image.startsWith('data:') ? image : await dataUrlFromFile(image) } }
  }
  if (image && typeof image === 'object') {
    if (typeof image.url === 'string') return { type: 'image_url', image_url: { url: image.url } }
    if (typeof image.path === 'string') {
      return { type: 'image_url', image_url: { url: await dataUrlFromFile(image.path, image.mimeType) } }
    }
    if (image.data !== undefined) {
      const mimeType = image.mimeType ?? 'image/png'
      const payload =
        Buffer.isBuffer(image.data) || image.data instanceof Uint8Array
          ? Buffer.from(image.data).toString('base64')
          : String(image.data)
      return { type: 'image_url', image_url: { url: `data:${mimeType};base64,${payload}` } }
    }
  }
  throw new TypeError('an image is a path, a data URL, or { data, mimeType }')
}

async function dataUrlFromFile(path, mimeType = IMAGE_MIME[extname(path).toLowerCase()] ?? 'image/png') {
  const bytes = await readFile(path)
  return `data:${mimeType};base64,${bytes.toString('base64')}`
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export { EVENT_TAGS, PROTOCOL_VERSION }
