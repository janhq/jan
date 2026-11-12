# llama.cpp hardware check

Runs every ggml operation on the user's devices and checks the results are
correct, so "the model gives bad output" can be told apart from "this machine's
q4_K matmul kernel is broken". It is upstream's `tests/test-backend-ops`,
compiled into `jan-llama-worker` and driven from the app.

Nothing is sent anywhere. The check runs locally and the report is handed to
the clipboard for the user to paste.

| Document | What is in it |
|---|---|
| [architecture.md](architecture.md) | The root/leaf process model, the upstream wrapper, how it is built |
| [event-schema.md](event-schema.md) | The versioned JSON contract between the worker and the app |
| [presets.md](presets.md) | Quick, Full and Model presets, shape filters, the vacuous-pass guards |
| [measurements.md](measurements.md) | Binary size, build time, case counts, runtimes |

## Running it

**In the app:** the llama.cpp provider settings page, under the engine panel.
Each GPU on the hardware page also links to it, carrying that device over.
A failed model load offers "Check why this model failed", which runs only the
ops that model's graph contains.

**From a terminal:**

```
jan-llama-worker --diagnose [--diagnose-preset quick|full] [--device NAME]...
                            [--workers N] [--family-timeout SECS] [--deadline SECS]
```

It prints one JSON event per line on stdout (see
[event-schema.md](event-schema.md)) and stops when its stdin closes. **A root
started with stdin on `/dev/null` cancels immediately** -- give it a pipe the
caller holds open.

The other modes exist for the root to call, but are useful by hand:

```
jan-llama-worker --diagnose-devices   # [{name, description, type, reg, memory_*}]
jan-llama-worker --diagnose-ops       # [{op, cases}] for every op family
jan-llama-worker --diagnose-run <device> [--mode test|support] [--op RE] [--params RE]
```

## Reading the result

A device gets one of four verdicts. Only one of them is a fault.

| Verdict | Means |
|---|---|
| Working correctly | Every operation returned the right answer. |
| Working correctly, some ops on the CPU | The device has no kernel for some ops, so ggml runs them elsewhere. Slower, not wrong. |
| Problems found | A kernel computed the wrong answer, or the process died. A model using it will produce bad output or fail to load. |
| Inconclusive | Part of the check tested nothing. Not a pass -- see [presets.md](presets.md). |

**"Falls back to CPU" is not a failure.** It is the single most important thing
to get right when reading a report: a device that does not implement an op is
normal, and painting it red sends people chasing a non-problem. It explains
slowness, nothing else.

A crashed or hung family is reported as such and the run continues with the
next one. That is the whole reason a leaf is a separate process: a
`GGML_ASSERT` or a lost device costs one family, not the run and not the app.

## Scope

The op cases do not exercise shader or pipeline compilation failures, model
architecture support, or anything above the kernel level. A load that fails
before any kernel runs is covered by the diagnostics attached to the load
error itself, not by this.
