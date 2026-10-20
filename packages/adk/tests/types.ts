// Compile-time assertions over the generated types and the public surface.
//
// Nothing here is executed: `tsc -p tsconfig.json` includes this file, so a
// shape that stops type-checking - a generated event union that loses a tag, a
// handler contract that stops accepting what the README shows - fails the
// package's own check rather than a consumer's build.
//
// The wire-shaped literals below are the same ones the runtime sends; the
// behavioral suite in `adk.test.mjs` is what proves they are real.

import { EVENT_TAGS, PROTOCOL_VERSION, JanRuntime, type EventTag, type RpcResponses, type StreamEvent } from '../src/index.js'
import type { RpcParams } from '../src/generated/rpc-types.js'

declare function expectType<T>(value: T): T

// The protocol version is a literal from the schema, not a number.
expectType<1>(PROTOCOL_VERSION)
expectType<readonly EventTag[]>(EVENT_TAGS)

// The event union is discriminated on `type`, and each tag is assignable to its
// own record - which is what a consumer's `switch (event.type)` relies on.
const token: StreamEvent = { type: 'token', text: 'hello' }
const toolRequest: StreamEvent = {
  type: 'tool_request',
  request_id: 'host-1',
  tool_name: 'robot_arm_move',
  args: { position: 'bin' },
  run_id: 'child-9',
}
const done: StreamEvent = { type: 'done', stop_reason: 'stop', usage: {} }
const permission: StreamEvent = {
  type: 'permission_request',
  request_id: 'perm-1',
  tool_name: 'bash',
  capability: 'actuator',
  prompt_kind: 'exec',
  offers_always: true,
}
expectType<string>(token.text)
expectType<string | null | undefined>(toolRequest.run_id)
expectType<string>(done.stop_reason)
if (permission.type === 'permission_request') expectType<string>(permission.tool_name)
if (toolRequest.type === 'tool_request') expectType<unknown>(toolRequest.args)

// A tag the schema does not have is a compile error, which is the point of
// generating the union instead of writing it out.
// @ts-expect-error `tokn` is not an event tag
const misspelled: StreamEvent = { type: 'tokn', text: 'x' }
expectType<StreamEvent>(misspelled)

// Request params are typed per method.
expectType<RpcParams<'session/start'>>({ cwd: '/tmp' })
expectType<RpcParams<'tool/respond'>>({ requestId: 'host-1', content: 'moved' })
// @ts-expect-error `cwd` is required by session/start
expectType<RpcParams<'session/start'>>({})
// @ts-expect-error `content` is a string or parts, not a number
expectType<RpcParams<'tool/respond'>>({ requestId: 'host-1', content: 7 })

// Responses, which the schema does not describe: declared in `index.d.ts` and
// pinned by the suite against a real runtime.
declare const runtime: JanRuntime
expectType<Promise<RpcResponses['turn/start']>>(runtime.request('turn/start', { sessionId: 's', input: 'hi' }))
expectType<Promise<RpcResponses['session/tools/get']>>(runtime.request('session/tools/get', { sessionId: 's' }))

// The public classes are constructible only the way the README shows.
expectType<Promise<JanRuntime>>(JanRuntime.start({ bin: 'jan' }))
