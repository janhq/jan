# Event schema

One JSON object per line on the root's stdout, discriminated by `event`.
`engine::diagnose::RootEvent` is the producer; `guest-js/types.ts`
`DiagnosticsEvent` is the consumer. The two must be changed together.

Current version: **`schema: 2`**.

Bump it when an existing event changes shape. Adding a *new* event does not
need a bump: readers are required to ignore an `event` they do not know
(`DiagEvent::Unknown` is the precedent).

| Event | Fields |
|---|---|
| `start` | `schema`, `preset`, `engine {version, tag, commit}`, `families[]`, `model?`, `support_probe`, `backend_modules[]`, `units`, `family_timeout_secs`, `deadline_secs` |
| `device` | `name`, `description`, `type`, `reg`, `memory_total_mib?`, `memory_free_mib?` |
| `family_start` | `device`, `family`, `mode` |
| `case` | `device`, `family`, then the leaf's own result flattened in: `backend`, `op`, `params`, `mode`, `status`, `error?`, `detail?` |
| `family_end` | `device`, `family`, `status`, `ok`, `failed`, `not_supported`, `millis`, `exit?`, `last_lines[]`, `unparsed[]` |
| `summary` | `device`, `ok`, `failed`, `not_supported`, `families_crashed`, `families_hung`, `families_no_cases` |
| `done` | `ok`, `cancelled`, `inconclusive`, `error?` |

Order: one `start`, a `device` per device, then `family_start` / `case`\* /
`family_end` per unit (device-major), then a `summary` per device, then exactly
one `done`. A run always ends with `done`, including when cancelled.

`case` is flattened rather than nested so a reader handles one flat object
instead of reaching through a wrapper. `DiagCase` is the same struct the leaf
serializes, so the two cannot drift.

## `done.ok` means "a clean bill of health", not "nothing failed"

A run with any `no_cases` family reports `ok: false` **and**
`inconclusive: true`. This matters because a narrowed shape filter can match no
case at all, and a reader that checks the obvious field alone must never be
told that a run which tested nothing went fine. Check `inconclusive` to tell
that apart from a real failure; the two are never both set.

This follows the convention test runners settled on long ago -- "no tests
matched the filter" is not success.

## Case status

`ok`, `fail`, `not_supported`, `skipped`.

`not_supported` is **not** a failure. It is the device saying ggml will run
that op somewhere else, which explains slowness rather than a wrong answer.

## Family status

| Status | What the root saw |
|---|---|
| `ok` | leaf exited 0, emitted `done`, no failing case |
| `fail` | leaf exited cleanly but a case failed, or `done` carried an error |
| `no_cases` | leaf exited cleanly, emitted `done`, and reported no case at all |
| `crashed` | leaf exited nonzero, **or** exited 0 without ever emitting `done`, **or** could not be started |
| `hung` | leaf outlived `--family-timeout` and was killed |
| `cancelled` | stdin closed, or `--deadline` passed, before the leaf finished |

Only `fail` means a kernel computed the wrong answer. `crashed` / `hung` /
`cancelled` are the leaf process itself going wrong, which is the whole reason
it is a separate process. `no_cases` is neither: the leaf ran cleanly and
tested nothing, because its filter matched nothing.

`exit` is `describe_exit`'s rendering, so a Windows crash reads as
`exit code 0xC0000005` rather than a meaningless negative decimal. A hung or
cancelled family has no `exit`: it was killed, so it never had a status of its
own.

`unparsed` holds leaf stdout lines that were not events, capped at 20 lines of
2000 characters. A leaf printing these is a bug on our side rather than
anything about the machine, so they are reported rather than dropped. Noise
alone never fails a family.

## Version history

| Schema | Change |
|---|---|
| 1 | Initial contract. |
| 2 | Added `FamilyStatus::no_cases`, `summary.families_no_cases`, `done.inconclusive`, `start.model`. |
