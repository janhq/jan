# jan-agent-sdk

Python client for the Jan agent runtime: sessions, streamed turns, and the host
tools your own process runs. It speaks the JSON-RPC channel of
`jan cli agent rpc`, so an embedding application gets one long-lived runtime
process serving many addressable sessions.

- Python 3.11+, standard library only - no Node, no third-party packages.
- The runtime is spawned and owned: a crash, an EOF or `close()` settles every
  parked turn and tool call, and the process is reaped.
- Types are generated from `protocol/rpc-schema.json`, the same document the
  Rust dispatcher publishes.

## Install

```bash
pip install jan-agent-sdk
```

The runtime binary is separate: `jan` must be on `PATH`, or named by
`$JAN_BIN` (the `bin` argument overrides both). A package that ships the runtime
is the distribution half of the same protocol; until then, build it with
`make agent` in the Jan repository.

## Quickstart

```python
from jan_agent_sdk import JanRuntime

with JanRuntime.start() as runtime:
    session = runtime.create_session(model="gpt-4o-mini", ephemeral=True)
    turn = session.prompt("Summarise this table in one line.")

    for event in turn:                      # blocks until the turn ends
        if event["type"] == "token":
            print(event["text"], end="", flush=True)

    print(turn.result().stop_reason)
```

`prompt()` returns as soon as the turn starts; iterating the turn yields the
events while it runs, and `result()` blocks for the terminal record. Iterating
is optional - a host that only calls `result()` still gets it - but an undrained
turn keeps at most `max_buffered_events` (default 100000) *unread* events and
then drops its oldest, counting them on `turn.dropped`. The cap is the buffer,
not the turn: a reader that keeps up with a turn of any length loses nothing.

## Host tools

A host tool is declared with the schema the model sees, what it does, and the
handler that runs it here:

```python
from jan_agent_sdk import HostTool, JanRuntime

def observe(args, call):
    return {"text": "the bench holds a red bin", "images": [frame_path]}

def move(args, call):
    arm.move(args["position"], abort=call.aborted)   # a threading.Event
    return {"text": f"moved to {args['position']}", "details": {"joints": 3}}

with JanRuntime.start() as runtime:
    session = runtime.create_session(
        model="gpt-4o-mini",
        builtins=False,                               # only the tools below
        permissions="host",                           # this process gates them itself
        tools=[
            HostTool(
                name="camera_observe",
                description="Look at the robot bench and describe what is there.",
                parameters={"type": "object", "properties": {}, "additionalProperties": False},
                capability="read",                    # never prompted, concurrent
                handler=observe,
            ),
            HostTool(
                name="robot_arm_move",
                description="Move the arm to a named position.",
                parameters={
                    "type": "object",
                    "properties": {"position": {"type": "string"}},
                    "required": ["position"],
                },
                capability="actuator",                 # prompted, sequential
                handler=move,
            ),
        ],
    )
```

What a handler answers with:

| Field | Meaning |
| --- | --- |
| `text` | Tool text, sent to the model. |
| `images` | A path, a data URL, `{data, mimeType}`, or `{url}`. A tool message cannot carry an image, so `text` stays on the tool message and the runtime leads the next user turn with the image parts. |
| `details` | Host-only data, echoed as `item/tool_details` and never sent to the model. |
| `error` / `isError` | The call failed; the message is the tool result the model sees. |

A raised exception is answered the same way, so a failed call never leaves the
turn parked. Each handler runs on its own thread, so the client's reader is
never held and two subagents may have calls in flight at once: serializing them
- one native call at a time, on a shared robot - is the host's decision through
its own queue. `call.aborted` is set when the runtime withdraws the request (an
interrupt, or the client going away), and a late answer is not written.

Requests from a delegated child arrive on the same session carrying `run_id`;
the answer is by `request_id` alone, so one path serves both.

`session.tools` and `session.tool_specs` are what the runtime advertises, read
back rather than assumed: the names there are the declared ones with their
`host__` prefix, because that is what the model calls. The `tool_request` a
handler runs for carries the bare name the host declared.

### Permissions

An `actuator` is gated: the runtime asks before the call reaches the handler,
unless the session declares that the gate is the host's own.

- `permissions="host"` - for a session whose host tools this process runs and
  gates itself, which is the usual case for an embedding host. No prompt is
  raised for those tools, so a turn never waits on an answer nobody will give.
- `permissions="jan"` (the default) - the runtime owns the gate. A call to an
  `actuator` raises `permission_request` on the turn's stream, naming the
  advertised tool (`host__robot_arm_move`) and its `capability`. Answer it with
  `session.respond_permission(request_id, "allow_once" | "allow_always" | "deny")`,
  from the code draining the turn:

```python
for event in turn:
    if event["type"] == "permission_request":
        session.respond_permission(event["request_id"], "allow_once")
```

An unanswered request parks the turn: nothing moves until it is answered, the
turn is interrupted, or the runtime is closed. A `read` tool is never prompted
for, in either mode.

## Process ownership

```python
session.interrupt()               # the turn settles with stop_reason "interrupted"
session.set_model("...")          # between turns; refused mid-turn with -32001
session.fork()                    # a new session with this one's history and model
session.archive()                 # drop it from the runtime
runtime.close()                   # close stdin, then the process
runtime.close(force=True)         # skip the grace period and kill
```

`runtime.limits` is what the handshake advertised - `max_images`,
`max_image_bytes`, `max_message_image_bytes` and the accepted `mime_types` - so
a client that sends an image can check it before sending rather than discover
the cap by being rejected. `JanRpcError` is an answer (`code`, `retryable`), and
`JanRuntimeError` is the channel (spawn failure, protocol mismatch, exit), with
the runtime's own stderr attached.

Listeners registered with `session.on(...)` run on the SDK's own dispatch
thread, in the order the runtime emitted the events, so a listener may call back
into the runtime - answering a permission request from one is the case that
matters - but it must not block for long: the dispatch thread is shared.

## Types

`jan_agent_sdk/_generated.py` is generated from `protocol/rpc-schema.json` -
request params, the event union, and the method and event-tag literals - by the
same generator the JavaScript SDK uses:

```bash
node packages/agent-sdk/scripts/generate.mjs            # rewrite both SDKs' types
node packages/agent-sdk/scripts/generate.mjs --check    # fail on drift
```

The artifact covers request params and events, not responses; the suite pins the
responses it uses against a real runtime.

## Tests

The suite drives a real runtime against a stub provider on loopback - no
credentials, no network, no Node:

```bash
JAN_BIN=/path/to/jan python3 -m unittest discover -s sdk/python/tests -t sdk/python
```

It is skipped, not failed, when `JAN_BIN` is unset.
