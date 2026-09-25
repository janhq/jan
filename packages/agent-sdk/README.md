# @janhq/agent-sdk

JavaScript and TypeScript client for the Jan agent runtime: sessions, streamed
turns, and the host tools your own process runs. It speaks the JSON-RPC channel
of `jan cli agent rpc`, so an embedding application gets one long-lived runtime
process serving many addressable sessions.

- No build step, no runtime dependencies, Node 20+.
- The runtime is spawned and owned: a crash, an EOF or a `close()` settles every
  parked turn and tool call, and the process is reaped.
- Types are generated from `protocol/rpc-schema.json`, the same document the
  Rust dispatcher publishes.

## Install

```bash
npm install @janhq/agent-sdk
```

The runtime binary is separate, and there are three ways to have one: on `PATH`,
named by `process.env.JAN_BIN` (the `bin` option overrides both), or installed by
this package from the channel Jan publishes. That channel is a manifest naming,
per platform, the artifact and its SHA-256, so an install is reproducible rather
than whatever the URL serves today:

```js
import { JanRuntime, installRuntime } from '@janhq/agent-sdk'

const runtime = await installRuntime()            // downloaded once, then cached
const jan = await JanRuntime.start({ bin: runtime.bin })
```

`installRuntime()` maps this platform to its artifact (`darwin-universal`,
`linux-x86_64`, `linux-aarch64`, `windows-x86_64`, `windows-aarch64`), verifies
the published digest before extracting anything, and only then renames the
install into `JAN_AGENT_HOME` or the per-user cache directory. An install that
failed its digest, or that was interrupted mid-extract, is never visible as one:
`findRuntime()` answers `null` for it.

Each successful download gets an immutable generation directory. Only the small
lookup marker is atomically replaced, so concurrent installs and republished
versions cannot delete or change a binary path already returned to a caller.
Old generations remain until the cache is manually removed while no runtimes
are using it. Relative cache roots are resolved to absolute paths.

`version` and `sha256` pin. A matching cached install is returned without network
access; otherwise both are checked against the manifest. A mismatch is an error
rather than a substitution. `manifestUrl` names another channel;
the default is the nightly one. The macOS artifact is notarized, and getting a
runtime this way needs no Rust toolchain and no Jan Desktop.

```js
const pinned = await installRuntime({ version: '0.8.4-50' })   // must be what the manifest publishes
const found = await findRuntime({ version: '0.8.4-50' })       // reads the cache, no network
```

The nightly channel also publishes a shell installer, which is what the
[jan.ai SDK pages](https://jan.ai/docs/agent/sdk) use:

```bash
curl -fsSL https://delta.jan.ai/jan-cli/install-jan-agent.sh | bash
```

To build your own instead, `make agent` in the Jan repository.

## Quickstart

```js
import { JanRuntime } from '@janhq/agent-sdk'

const runtime = await JanRuntime.start()
const session = await runtime.createSession({ model: 'gpt-4o-mini', ephemeral: true })

const turn = await session.prompt('Summarise this table in one line.')

for await (const event of turn) {
  if (event.type === 'token') process.stdout.write(event.text)
}

const { stopReason } = await turn.result()
console.log(`\n${stopReason}`)

await runtime.close() // closes stdin, then the process
```

`prompt()` returns as soon as the turn starts; the events stream while it runs,
and `result()` resolves when the runtime closes the turn. Iterating is optional -
a host that only awaits `result()` still gets the terminal record - but an
undrained turn keeps at most `maxBufferedEvents` (default 100000) *unread*
events and then drops its oldest, counting them on `turn.dropped`. The cap is
the buffer, not the turn: a reader that keeps up with a turn of any length loses
nothing.

## Host tools

A host tool is declared with the schema the model sees, what it does, and the
handler that runs it here:

```js
const session = await runtime.createSession({
  model: 'gpt-4o-mini',
  builtins: false, // only the tools below, no shell/editor/subagent tools
  permissions: 'host', // this process runs and gates these tools itself
  tools: [
    {
      name: 'camera_observe',
      description: 'Look at the robot bench and describe what is there.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      capability: 'read', // never prompted, run concurrently, visible in Plan mode
      handler: async () => ({ text: 'the bench holds a red bin', images: [framePath] }),
    },
    {
      name: 'robot_arm_move',
      description: 'Move the arm to a named position.',
      parameters: {
        type: 'object',
        properties: { position: { type: 'string' } },
        required: ['position'],
      },
      capability: 'actuator', // prompted, sequential, withheld in Plan mode
      handler: async (args, call) => {
        await arm.move(args.position, { signal: call.signal })
        return { text: `moved to ${args.position}`, details: { joints: 3 } }
      },
    },
  ],
})
```

What a handler answers with:

| Field | Meaning |
| --- | --- |
| `text` | Tool text, sent to the model. |
| `images` | A path, a data URL, `{ data, mimeType }`, or `{ url }`. A tool message cannot carry an image, so `text` stays on the tool message and the runtime leads the next user turn with the image parts. |
| `details` | Host-only data, echoed as `item/tool_details` and never sent to the model. |
| `error` / `isError` | The call failed; the message is the tool result the model sees. |

A thrown error is answered the same way, so a failed call never leaves the turn
parked. The handler runs without holding the client's reader: two subagents may
have calls in flight at once, and serializing them - one native call at a time,
on a shared robot - is the host's decision through its own queue. `call.signal`
is aborted when the runtime withdraws the request (an interrupt, or the client
going away), and a late answer is not written.

Requests from a delegated child arrive on the same session, carrying
`run_id`; answer is by `request_id` alone, so one path serves both.

`session.tools` and `session.toolSpecs` are what the runtime advertises, read
back rather than assumed: the names there are the declared ones with their
`host__` prefix, because that is what the model calls. The `tool_request` a
handler runs for carries the bare name the host declared.

### Permissions

An `actuator` is gated: the runtime asks before the call reaches the handler,
unless the session declares that the gate is the host's own.

- `permissions: 'host'` - for a session whose host tools this process runs and
  gates itself, which is the usual case for an embedding host. No prompt is
  raised for those tools, so a turn never waits on an answer nobody will give.
- `permissions: 'jan'` (the default) - the runtime owns the gate. A call to an
  `actuator` raises `permission_request` on the turn's stream, naming the
  advertised tool (`host__robot_arm_move`) and its `capability`. Answer it with
  `session.respondPermission(requestId, 'allow_once' | 'allow_always' | 'deny')`,
  from the code draining the turn:

```js
for await (const event of turn) {
  if (event.type === 'permission_request') {
    await session.respondPermission(event.request_id, 'allow_once')
  }
}
```

An unanswered request parks the turn: nothing moves until it is answered, the
turn is interrupted, or the runtime is closed. A `read` tool is never prompted
for, in either mode.

## Process ownership

```js
await session.interrupt()      // the turn settles with stopReason 'interrupted'
await session.setModel('...')  // between turns; refused mid-turn with -32001
await session.fork()           // a new session with this one's history and model
await session.archive()        // drop it from the runtime
await runtime.close()          // close stdin, then the process
await runtime.close({ force: true }) // skip the grace period and kill
```

`runtime.limits` is what the handshake advertised - `max_images`,
`max_image_bytes`, `max_message_image_bytes` and the accepted `mime_types` - so
a client that sends an image can check it before sending rather than discover
the cap by being rejected. `JanRpcError` is an answer (`code`, `retryable`), and
`JanRuntimeError` is the channel (spawn failure, protocol mismatch, exit), with
the runtime's own stderr attached.

## Types

`src/index.d.ts` is the public surface. `src/generated/rpc-types.d.ts` is
generated from `protocol/rpc-schema.json` - request params, the event union, and
the method and event-tag literals:

```bash
yarn workspace @janhq/agent-sdk generate        # rewrite the generated files
yarn workspace @janhq/agent-sdk check-types     # regenerate, diff, type-check
```

The artifact covers request params and events, not responses; `RpcResponses` in
`src/index.d.ts` declares those and the suite pins them against a real runtime.

## Tests

The suite drives a real runtime against a stub provider on loopback - no
credentials, no network:

```bash
JAN_BIN=/path/to/jan yarn workspace @janhq/agent-sdk test
```

It is skipped, not failed, when `JAN_BIN` is unset.
