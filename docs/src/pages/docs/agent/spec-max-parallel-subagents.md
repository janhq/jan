---
title: Max Parallel Subagents - Design Spec
description: Design for capping concurrent subagents with a visible TUI queue.
keywords:
  [Jan, Jan Agent, subagents, parallelism, queue, max_parallel_subagents, design spec]
---

# Max Parallel Subagents - Design Spec

## Problem

`dispatch_subagent` spawns one background task per call with no concurrency limit
(`src/core/agent/subagent.rs` - `spawn_subagent` calls `tokio::spawn`
unconditionally; `BackgroundSubagents` only supports teardown via
`abort_all`/`join_all`). A model that dispatches 10+ subagents launches all of
them at once; each competes for provider rate limits, context, and turn budget,
so high fan-out stalls or times out. There is no knob to bound it and no way to
see the resulting contention.

## Design

### Config

New `[agent]` key in `agent.toml`: `max_parallel_subagents`, default `10`.

Semantics: at most N subagents of a single parent run may be running (spawned
task) at once. Requests beyond N queue; they never error for being over the cap.

The cap is snapshot at run start. Re-reading `agent.toml` mid-run does not
reshuffle the queue; the new value applies to the next run.

### Admission control

`spawn_subagent` becomes two-phase:

1. Resolve the request exactly as today (registry lookup, permission check,
   `run_id` allocation, oneshot channel creation).
2. If running count < cap: spawn the task immediately and register in
   `BackgroundSubagents` as `Running`.
3. Else: register as `Queued` (FIFO) and return the `run_id` immediately. The
   task body does not start.

A slot frees when a child finishes, is collected by `await_subagent`, or is
aborted. When a slot frees, dequeue the oldest queued child and spawn it.

The queue is per-parent-run. Subagents cannot spawn grandchildren
(`loop.rs`), so there is exactly one level to police.

### Queue state in `BackgroundSubagents`

`BackgroundEntry` gains a `Queued` variant (or a `queued: bool` + pending
request). Running children keep the current `result`/`abort` fields; queued
children hold the resolved request until promoted.

- `abort_all`: abort running children and drop queued ones (emit the closing
  `SubagentEnd` for each, exactly as running aborts do).
- `join_all`: wait on running children; queued children never started, so they
  are simply dropped on clean exit - but must still emit `SubagentEnd` so the
  transcript never sees an unbracketed `SubagentStart`.

### `await_subagent` on a queued run

`await_subagent(run_id)` on a queued child must block until a slot frees, then
run to completion. It must not deadlock: awaiting a queued child that sits
behind a running child that is itself awaited by the same parent is the
model's job to sequence; we only guarantee the await resolves once the child
actually runs. `await_subagent` on a queued child does not promote it early -
the FIFO order is preserved.

### TUI

`SubagentBlock` (tui.rs) currently renders running children with a live
tool-call window. Add a distinct `queued` state:

- Queued children render `queued (n waiting)` with a different glyph/status
  from `working`, so a stalled run reads as "waiting for a slot", not stuck.
- The block's live-update path already receives `SubagentStart`; queued
  children get their own synthetic row that flips to the running render when
  promoted.

### TUI settings surface

Today `/config` is read-only and shows only `~/.jan/config.toml` providers.
Extend it (or add `/settings`) to edit `[agent]` keys, starting with
`max_parallel_subagents`, ideally the full set (`context_window`,
`compaction_reserve_tokens`, `max_tokens`, `instructions_file`). Writes go
through the same `agent.toml` writer the CLI uses; input validated (integer,
>= 1).

## Out of scope

- Cross-run (process-wide) concurrency limiting.
- Rejecting dispatches instead of queueing.
- Any web-app / desktop settings changes (TUI only).
- Changing the cap for already-running children when config changes mid-run.
