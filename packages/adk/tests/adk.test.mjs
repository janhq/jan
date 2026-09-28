// The JavaScript ADK, driven end to end against a real runtime.
//
// The subject is the process boundary: every claim here is about what crosses
// it - the handshake, a turn's events, a host tool's answer becoming the tool
// message the model sees on the next request, an interrupt settling a parked
// call exactly once. A unit test with a fake runtime would assert the client
// agrees with itself; this asserts it agrees with `jan`.
//
// The provider is a stub on loopback, so the suite needs no credentials and no
// network. Set `JAN_BIN` to the runtime binary to run it (the ADK's CI job
// builds one; locally, `make agent` or a cargo build of `jan-cli`).

import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { JanRuntime, JanRuntimeError, PROTOCOL_VERSION } from '../src/index.js'

const run = promisify(execFile)
const bin = process.env.JAN_BIN
const missingRuntime = bin ? false : 'set JAN_BIN to the jan binary to run the ADK suite'

// A chunk the model asks for the host tool with. `host__` is the advertised
// name; the host is told the bare one.
const TOOL_CALL = (name, args) =>
  [
    `data: ${JSON.stringify({
      id: 'stub-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'stub-model',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              { index: 0, id: 'call-1', type: 'function', function: { name, arguments: JSON.stringify(args) } },
            ],
          },
          finish_reason: null,
        },
      ],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: 'stub-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'stub-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    })}\n\n`,
    'data: [DONE]\n\n',
  ].join('')

// Plain prose, which ends the run.
const PROSE = (text) =>
  [
    `data: ${JSON.stringify({
      id: 'stub-2',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'stub-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: 'stub-2',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'stub-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
    })}\n\n`,
    'data: [DONE]\n\n',
  ].join('')

// One token, then the socket stays open: a turn a test can interrupt in the
// middle of, rather than after it finished.
const HOLDING = (text) =>
  `data: ${JSON.stringify({
    id: 'stub-3',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'stub-model',
    choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
  })}\n\n`

// One token per chunk, paced: a turn long enough that its total output passes
// the buffer cap while a reader keeps up with it. A cap on the running total
// would start dropping events this reader never missed.
const STREAM = (tokens, delayMs, burst = 1) => async (response) => {
  const chunk = (delta, finish = null, extra = '') =>
    `data: ${JSON.stringify({
      id: 'stub-4',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'stub-model',
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...extra,
    })}\n\n`
  for (const [index, text] of tokens.entries()) {
    response.write(chunk({ role: 'assistant', content: text }))
    // `burst` events back to back, then a pause: a reader falls a few events
    // behind inside a burst and catches up between them, which is what tells a
    // cap on the buffer apart from a count of everything ever buffered.
    if (delayMs && (index + 1) % burst === 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  response.end(
    chunk({}, 'stop', { usage: { prompt_tokens: 9, completion_tokens: tokens.length, total_tokens: 9 + tokens.length } }) +
      'data: [DONE]\n\n',
  )
}

// Serve `replies` in order, one per connection, repeating the last once they
// run out. Bodies are kept so a test can assert what the model was actually
// sent - which is where a host tool's answer has to land for a round trip to
// mean anything.
class Provider {
  #server
  #sockets = new Set()

  constructor(replies) {
    this.replies = replies
    this.bodies = []
    this.connections = 0
  }

  async start() {
    this.#server = createServer((request, response) => {
      const index = this.connections++
      const reply = this.replies[Math.min(index, this.replies.length - 1)]
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        this.bodies.push(body)
        response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
        if (typeof reply === 'function') {
          this.#sockets.add(response)
          reply(response, () => this.#sockets.delete(response))
          return
        }
        response.end(reply)
      })
    })
    await new Promise((resolve) => this.#server.listen(0, '127.0.0.1', resolve))
    const { port } = this.#server.address()
    return `http://127.0.0.1:${port}/v1`
  }

  async stop() {
    for (const socket of this.#sockets) socket.destroy()
    this.#sockets.clear()
    if (this.#server) await new Promise((resolve) => this.#server.close(resolve))
  }
}

// A private home and project, removed after the test.
class Scratch {
  static async create(name) {
    const root = await mkdtemp(join(tmpdir(), `jan-adk-${name}-`))
    const scratch = new Scratch(root)
    await mkdir(scratch.home, { recursive: true })
    await mkdir(scratch.project, { recursive: true })
    return scratch
  }

  constructor(root) {
    this.root = root
    this.home = join(root, 'home')
    this.project = join(root, 'project')
  }

  // Point the runtime at the stub provider, so a session can resolve a model.
  async configure(baseUrl) {
    await run(
      bin,
      ['config', 'set', '--provider', 'stub', '--api-key', 'test-key', '--base-url', baseUrl, '--model', 'stub-model'],
      { env: this.env },
    )
  }

  get env() {
    return { ...process.env, HOME: this.home, JAN_CLI_NO_UPDATE_CHECK: '1' }
  }

  get projectPath() {
    return this.project
  }

  start(options = {}) {
    return JanRuntime.start({ bin, env: this.env, ...options })
  }

  async cleanup() {
    await rm(this.root, { recursive: true, force: true })
  }
}

// One test's runtime, provider and scratch home, torn down whether the test
// passed, failed or threw. A leaked stub server or child process keeps the
// test runner waiting on the event loop, which is a hang rather than a
// failure - so cleanup is registered before the first assertion.
async function connect(t, { replies, runtime = {} } = {}) {
  const provider = new Provider(replies)
  const baseUrl = await provider.start()
  const scratch = await Scratch.create('case')
  await scratch.configure(baseUrl)
  const jan = await scratch.start(runtime)
  t.after(async () => {
    await jan.close({ force: true }).catch(() => {})
    await provider.stop()
    await scratch.cleanup()
  })
  return { provider, scratch, runtime: jan }
}

// The events of a turn, collected while it runs.
async function collect(turn) {
  const events = []
  for await (const event of turn) events.push(event)
  return events
}

test('a runtime handshakes and reports its caps', { skip: missingRuntime }, async (t) => {
  const { runtime } = await connect(t, { replies: [PROSE('unused')] })
  assert.equal(runtime.protocolVersion, PROTOCOL_VERSION)
  assert.equal(runtime.serverInfo.name, 'jan')
  assert.equal(runtime.capabilities.session, true)
  // The caps are the handshake's business: a client that sends an image learns
  // the limits here rather than from a rejection.
  assert.ok(runtime.limits, 'the handshake advertises the content-part caps')
  assert.ok(runtime.limits.max_images >= 1)
  assert.ok(runtime.limits.mime_types.includes('image/png'))
  assert.ok(runtime.pid > 0)

})

test('a runtime that is not there fails before any work starts', { skip: missingRuntime }, async (t) => {
  await assert.rejects(
    JanRuntime.start({ bin: join(tmpdir(), 'jan-does-not-exist'), env: process.env }),
    (error) => error instanceof JanRuntimeError,
  )
})

test('a session runs a turn and reports its own state', { skip: missingRuntime }, async (t) => {
  const { scratch, runtime } = await connect(t, { replies: [PROSE('the arm reached bin')] })
  const session = await runtime.createSession({
    cwd: scratch.projectPath,
    model: 'stub-model',
    ephemeral: true,
    builtins: false,
  })
  assert.ok(session.id)
  assert.equal(session.model, 'stub-model')

  const seen = []
  session.on('event', (event) => seen.push(event.type))
  const turn = await session.prompt('move the arm')
  const events = await collect(turn)
  const result = await turn.result()

  assert.equal(result.stopReason, 'completed')
  const text = events.filter((event) => event.type === 'token').map((event) => event.text).join('')
  assert.equal(text, 'the arm reached bin')
  assert.ok(events.some((event) => event.type === 'step'))
  // The session hears what the turn hears, so a host can observe a run it is
  // not the one iterating.
  assert.ok(seen.includes('token'))

  // State that a host reads back rather than assumes.
  const tools = await session.getTools()
  assert.deepEqual(tools.tools, [])
  const sessions = await runtime.listSessions()
  assert.equal(sessions.find((entry) => entry.id === session.id).turns, 1)
  assert.equal(await session.setModel('stub-model'), 'stub-model')
  await session.reset()
  await session.archive()

})

test('a host tool round-trips: the handler runs, the model gets the answer', { skip: missingRuntime }, async (t) => {
  const calls = []
  const { provider, scratch, runtime } = await connect(t, {
    replies: [TOOL_CALL('host__robot_arm_move', { position: 'bin' }), PROSE('the arm reached bin')],
  })
  const session = await runtime.createSession({
    cwd: scratch.projectPath,
    model: 'stub-model',
    ephemeral: true,
    // Built-ins off, so the advertised set is exactly what this test declared,
    // and the gate is the host's: an actuator this client runs itself must not
    // be prompted for twice.
    builtins: false,
    permissions: 'host',
    tools: [
      {
        name: 'robot_arm_move',
        description: 'Move the arm.',
        parameters: { type: 'object', properties: { position: { type: 'string' } }, required: ['position'] },
        capability: 'actuator',
        handler: (args, call) => {
          calls.push({ args, call })
          return { text: 'moved to bin', details: { joints: 3 } }
        },
      },
    ],
  })
  // The runtime advertises the model-facing name, which is the declared one
  // with its `host__` prefix; the host is told the name it chose (below).
  assert.deepEqual(session.tools, ['host__robot_arm_move'])
  assert.equal(session.toolSpecs[0].function.name, 'host__robot_arm_move')

  const turn = await session.prompt('move the arm')
  const events = await collect(turn)
  const result = await turn.result()
  assert.equal(result.stopReason, 'completed')

  const request = events.find((event) => event.type === 'tool_request')
  assert.ok(request, 'the host was asked')
  // The host dispatches on the name it declared, not the `host__` name the
  // model calls, and a main-run request carries no run id.
  assert.equal(request.tool_name, 'robot_arm_move')
  assert.deepEqual(request.args, { position: 'bin' })
  assert.equal(request.run_id ?? null, null)
  assert.deepEqual(request.args, calls[0].args)
  assert.equal(calls[0].call.toolName, 'robot_arm_move')
  assert.equal(calls[0].call.runId, null)
  assert.equal(calls[0].call.session, session)

  // The tool's answer became the tool message of the next provider request:
  // that, not the handler call, is what makes the round trip real.
  assert.equal(provider.bodies.length, 2, 'the model was asked twice')
  assert.match(provider.bodies[1], /moved to bin/)
  // `details` is host-only: it is echoed back on the channel and never sent.
  assert.doesNotMatch(provider.bodies[1], /joints/)

})

test('an image-bearing host result reaches the model as an image part', { skip: missingRuntime }, async (t) => {
  // A 1x1 PNG, which is a valid payload and small enough to inline here.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAB/wDcH1jPAAAAAElFTkSuQmCC'
  const { provider, scratch, runtime } = await connect(t, {
    replies: [TOOL_CALL('host__camera_observe', { frame: 1 }), PROSE('the bin is clear')],
  })
  const session = await runtime.createSession({
    cwd: scratch.projectPath,
    model: 'stub-model',
    ephemeral: true,
    builtins: false,
    permissions: 'host',
    tools: [
      {
        name: 'camera_observe',
        description: 'Look at the bench.',
        capability: 'read',
        handler: () => ({ text: 'the bench', images: [{ data: png, mimeType: 'image/png' }] }),
      },
    ],
  })

  const turn = await session.prompt('look at the bench')
  await collect(turn)
  await turn.result()

  const body = provider.bodies[1]
  const messages = JSON.parse(body).messages
  assert.equal(messages.at(-2).role, 'tool', 'the tool message reported the result')
  assert.equal(messages.at(-2).content, 'the bench')
  // A tool message cannot carry an image, so the runtime labels the user turn
  // the result produces and leads it with the parts the host wrote; the label
  // names the call, and the host's own text stayed on the tool message.
  const parts = messages.at(-1)
  assert.equal(parts.role, 'user')
  assert.ok(Array.isArray(parts.content), 'the user message carries content parts')
  assert.equal(parts.content[0].type, 'text')
  assert.ok(parts.content[0].text.length > 0, 'the user turn is labelled')
  assert.equal(parts.content[1].type, 'image_url')
  assert.equal(parts.content[1].image_url.url, `data:image/png;base64,${png}`)

})

test('a handler that throws answers the call as an error, and the turn goes on', { skip: missingRuntime }, async (t) => {
  const { provider, scratch, runtime } = await connect(t, {
    replies: [TOOL_CALL('host__robot_arm_move', { position: 'bin' }), PROSE('the arm did not move')],
  })
  const session = await runtime.createSession({
    cwd: scratch.projectPath,
    model: 'stub-model',
    ephemeral: true,
    permissions: 'host',
    tools: [
      {
        name: 'robot_arm_move',
        capability: 'actuator',
        handler: () => {
          throw new Error('the emergency stop is engaged')
        },
      },
    ],
  })

  const turn = await session.prompt('move the arm')
  await collect(turn)
  const result = await turn.result()

  // An error is an answer, not a dropped turn: the model is told, and the run
  // finishes with its own stop reason.
  assert.equal(result.stopReason, 'completed')
  assert.match(provider.bodies[1], /the emergency stop is engaged/)

})

test('interrupting a turn settles it once, and abandons its parked call', { skip: missingRuntime }, async (t) => {
  let aborted = false
  let answered = 0
  const { scratch, runtime } = await connect(t, {
    replies: [TOOL_CALL('host__robot_arm_move', { position: 'bin' }), (response) => response.write(HOLDING('working on it'))],
  })
  const session = await runtime.createSession({
    cwd: scratch.projectPath,
    model: 'stub-model',
    ephemeral: true,
    permissions: 'host',
    tools: [
      {
        name: 'robot_arm_move',
        capability: 'actuator',
        handler: (_args, call) =>
          new Promise((resolve) => {
            call.signal.addEventListener('abort', () => {
              aborted = true
              answered += 1
              resolve({ text: 'too late' })
            })
          }),
      },
    ],
  })

  const turn = await session.prompt('move the arm')
  const events = []
  const reading = (async () => {
    for await (const event of turn) {
      events.push(event)
      if (event.type === 'tool_request') await session.interrupt()
    }
  })()
  const result = await turn.result()
  await reading

  assert.equal(result.stopReason, 'interrupted')
  // The parked call is withdrawn rather than answered: the runtime would refuse
  // a late answer as not pending, so the ADK must not write one.
  assert.ok(events.some((event) => event.type === 'tool_request_cancelled'))
  // The handler is told on its own turn of the event loop, so the terminal
  // record can arrive first; wait for the notice instead of racing it.
  const deadline = Date.now() + 5000
  while (!aborted && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(aborted, true, 'the handler was told to stop')
  assert.equal(answered, 1)
  assert.equal(turn.dropped, 0)

})

test('a permission request the runtime owns is answered by the host', { skip: missingRuntime }, async (t) => {
  const calls = []
  const { scratch, runtime } = await connect(t, {
    replies: [TOOL_CALL('host__robot_arm_move', { position: 'bin' }), PROSE('the arm reached bin')],
  })
  // No `permissions: 'host'`: the runtime owns the gate, so an actuator is
  // prompted before the call reaches its handler.
  const session = await runtime.createSession({
    cwd: scratch.projectPath,
    model: 'stub-model',
    ephemeral: true,
    builtins: false,
    tools: [
      {
        name: 'robot_arm_move',
        capability: 'actuator',
        handler: (args) => {
          calls.push(args)
          return { text: 'moved to bin' }
        },
      },
    ],
  })

  const turn = await session.prompt('move the arm')
  const events = []
  const reading = (async () => {
    for await (const event of turn) {
      events.push(event)
      if (event.type === 'permission_request') {
        // The prompt names the tool the model called - the advertised one.
        assert.equal(event.tool_name, 'host__robot_arm_move')
        assert.equal(typeof event.capability, 'string')
        await session.respondPermission(event.request_id, 'allow_once')
      }
    }
  })()
  const result = await turn.result()
  await reading

  assert.equal(result.stopReason, 'completed')
  assert.deepEqual(calls, [{ position: 'bin' }], 'the call ran once the host allowed it')
  assert.ok(events.some((event) => event.type === 'tool_request'))
})

test("a steer lands in the model's next request", { skip: missingRuntime }, async (t) => {
  const { provider, scratch, runtime } = await connect(t, {
    replies: [TOOL_CALL('host__camera_observe', { frame: 1 }), PROSE('the left bench is clear')],
  })
  // The steer has to be in before the tool's answer goes back: that answer ends
  // the window in which the runtime still sees the turn as steerable. The
  // handler runs inside that window, so the steer cannot lose a race the way a
  // listener on a dispatch thread can.
  const session = await runtime.createSession({
    cwd: scratch.projectPath,
    model: 'stub-model',
    ephemeral: true,
    builtins: false,
    permissions: 'host',
    tools: [
      {
        name: 'camera_observe',
        capability: 'read',
        handler: async () => {
          await session.steer('also check the left bench')
          return { text: 'the bench' }
        },
      },
    ],
  })

  const turn = await session.prompt('look at the bench')
  for await (const _event of turn);

  const result = await turn.result()
  assert.equal(result.stopReason, 'completed')
  // The steer is delivered at the turn's next safe point, which is the request
  // the runtime builds from the tool result.
  assert.ok(provider.bodies[1].includes('also check the left bench'))
})

test('two sessions never see each other’s events', { skip: missingRuntime }, async (t) => {
  const { scratch, runtime } = await connect(t, { replies: [PROSE('alpha'), PROSE('beta')] })
  const first = await runtime.createSession({ cwd: scratch.projectPath, model: 'stub-model', ephemeral: true })
  const second = await runtime.createSession({ cwd: scratch.projectPath, model: 'stub-model', ephemeral: true })

  const noise = []
  second.on('event', (event) => noise.push(event.type))

  const turn = await first.prompt('say alpha')
  const events = await collect(turn)
  await turn.result()

  assert.ok(events.some((event) => event.type === 'token' && event.text === 'alpha'))
  assert.deepEqual(noise, [], 'the other session heard nothing')

  // A fork is its own session, with its own id - and an address the runtime
  // answers for, which is what makes it usable rather than merely named.
  const fork = await first.fork()
  assert.equal(typeof fork.id, 'string')
  assert.ok(fork.id.length > 0)
  assert.notEqual(fork.id, first.id)
  assert.equal(fork.model, 'stub-model')
  const forked = await fork.getTools()
  assert.ok(forked.tools.includes('bash'))

})

test('a session is reopened by its id', { skip: missingRuntime }, async (t) => {
  const { scratch, runtime } = await connect(t, { replies: [PROSE('one'), PROSE('two')] })
  const first = await runtime.createSession({ cwd: scratch.projectPath, model: 'stub-model', ephemeral: true })
  const turn = await first.prompt('say something')
  await turn.result()

  // The runtime rebuilt this session from its own state, so the id it answers
  // for and the model it runs are the ones the first session had.
  const again = await runtime.resumeSession(first.id)
  assert.equal(again.id, first.id)
  assert.equal(again.model, 'stub-model')
  const resumed = await again.prompt('say something else')
  const done = await resumed.result()
  assert.equal(done.stopReason, 'completed')
})

test('closing the runtime settles an open turn instead of hanging', { skip: missingRuntime }, async (t) => {
  const { scratch, runtime } = await connect(t, { replies: [(response) => response.write(HOLDING('still here'))] })
  const session = await runtime.createSession({ cwd: scratch.projectPath, model: 'stub-model', ephemeral: true })
  const turn = await session.prompt('say something')
  const { code } = await runtime.close()

  // Closing stdin is the runtime's own shutdown signal, and a turn that was
  // running is closed on the channel before the process exits.
  assert.equal(code, 0)
  await assert.rejects(turn.result(), (error) => error instanceof JanRuntimeError)
})

test('a turn nobody drains stays bounded, and still reports its outcome', { skip: missingRuntime }, async (t) => {
  const { scratch, runtime } = await connect(t, { replies: [PROSE('unread')], runtime: { maxBufferedEvents: 0 } })
  const session = await runtime.createSession({ cwd: scratch.projectPath, model: 'stub-model', ephemeral: true })
  const turn = await session.prompt('say something')
  const result = await turn.result()

  // The events were dropped rather than held: the terminal record still
  // arrived, which is what a late reader needs most.
  assert.equal(result.stopReason, 'completed')
  assert.ok(turn.dropped > 0, 'the unread turn dropped events instead of growing')

})

test('a turn a reader keeps up with keeps every event, however long it runs', { skip: missingRuntime }, async (t) => {
  // Twenty bursts of four against a cap of 8: a reader falls a few events
  // behind inside a burst and catches up between them, so nothing is ever
  // further behind than the cap -- yet some 60 of the 80 events were buffered
  // on the way. Counting the turn's output instead of its buffer would drop the
  // events past the eighth, to a reader that missed none of them.
  const tokens = Array.from({ length: 80 }, (_, index) => `token ${index} `)
  const { scratch, runtime } = await connect(t, {
    replies: [STREAM(tokens, 10, 4)],
    runtime: { maxBufferedEvents: 8 },
  })
  const session = await runtime.createSession({ cwd: scratch.projectPath, model: 'stub-model', ephemeral: true })

  const turn = await session.prompt('ramble')
  const seen = []
  for await (const event of turn) if (event.type === 'token') seen.push(event.text)
  await turn.result()

  assert.equal(turn.dropped, 0, 'a reader that keeps up must not lose events')
  assert.equal(seen.length, tokens.length)

})

test('a listener by tag hears that tag, not everything', { skip: missingRuntime }, async (t) => {
  const { scratch, runtime } = await connect(t, {
    replies: [TOOL_CALL('host__camera_observe', { mode: 'rgb' }), PROSE('a red cup')],
  })
  const session = await runtime.createSession({
    cwd: scratch.projectPath,
    model: 'stub-model',
    ephemeral: true,
    builtins: false,
    tools: [
      {
        name: 'camera_observe',
        description: 'Look through the camera.',
        capability: 'read',
        parameters: { type: 'object', properties: { mode: { type: 'string' } }, required: ['mode'] },
        handler: () => ({ text: 'a red cup' }),
      },
    ],
  })

  const calls = []
  const texts = []
  const prompts = []
  const every = []
  const streamed = []
  session.on('tool_request', (event) => calls.push(event.tool_name))
  session.on('token', (event) => texts.push(event.text))
  session.on('permission_request', (event) => prompts.push(event))
  session.on('*', (event) => every.push(event))
  session.on('event', (event) => streamed.push(event))

  const turn = await session.prompt('what is on the desk?')
  for await (const _event of turn);
  await turn.result()

  // The host is told the name it declared, not the `host__` name the model
  // calls, and a read never asks permission - so that listener stays silent.
  assert.deepEqual(calls, ['camera_observe'])
  assert.equal(texts.join(''), 'a red cup')
  assert.deepEqual(prompts, [], 'nothing was gated, so nothing may be reported')
  // A tag is a second name for an event already reported, not a second event:
  // `'*'` hears the stream once.
  assert.deepEqual(every, streamed)

})

test('a request with no runtime behind it is refused, not hung', { skip: missingRuntime }, async (t) => {
  const { runtime } = await connect(t, { replies: [PROSE('unused')] })
  await assert.rejects(
    runtime.request('session/tools/get', { sessionId: 'not-a-session' }),
    (error) => error.code === -32602 && /unknown session/i.test(error.message),
  )
  await assert.rejects(
    runtime.request('turn/start', { sessionId: 'not-a-session', input: 'hi' }),
    (error) => error.name === 'JanRpcError',
  )
})
