# Architecture

Three layers: upstream's test driver compiled into the worker, a root process
that supervises leaves running it, and a Tauri command that republishes the
leaf events to the UI.

```
app (React)            tauri-plugin-llamacpp               jan-llama-worker
  LlamacppDiagnostics -> start_diagnostics ---- spawns --> --diagnose  (root, no ggml)
  useLlamacppDiagnostics <- llamacpp-diagnostics events        |  spawns one per unit
                                                               v
                                                          --diagnose-run (leaf, holds ggml)
                                                               |
                                                          jan_llama_diag.cpp
                                                               |
                                                          tests/test-backend-ops.cpp
```

## The upstream wrapper

`shim/jan_llama_diag.cpp` `#include`s llama.cpp's `tests/test-backend-ops.cpp`
unmodified, with its `main` renamed, and is compiled as one translation unit by
`build.rs` behind the `engine` feature. `LLAMA_BUILD_TESTS` stays OFF; this is
the only file out of that directory that is built. A llama.cpp bump either
compiles or fails loudly, which is the point of wrapping rather than forking a
13.9k-line file.

It needs only the four ggml headers (`ggml.h`, `ggml-alloc.h`, `ggml-backend.h`,
`ggml-cpp.h`) plus `nlohmann/json.hpp` from `vendor/`, and links only the
shared `ggml`/`ggml-base` the worker already links. No libllama, no libcommon,
no generated headers.

Entry points: `jan_llama_diag_run`, `jan_llama_diag_ops_json`,
`jan_llama_diag_backends_json`, wrapped by `Engine::diag_run` /
`diag_ops_json` / `diag_backends_json` in `engine/sys.rs` (an `Unavailable`
stub without the feature).

**Upstream writes to the process streams, so stdout had to be reclaimed.** The
console printer plus bare `printf`/`fprintf(stderr, ...)` in the case code
(failed allocation, `ERR = ...`, NaN reports, `graph_compute failed`, the Metal
FA slice runner) would corrupt a JSON stream. The TU redefines `printf` and
`fprintf` around the `#include` to capture into a per-thread buffer, which is
attached to the failing result as `detail`. That is the only edit, and it is in
our file, not upstream's. The macros are defined after every standard header
the upstream file includes, so a header that merely mentions the token is not
rewritten.

Remaining stderr noise is ggml's own log callback (`load_backend: ...`,
`ggml_cuda_init`, `ggml_vulkan`), which is not upstream's file. A leaf
therefore keeps stdout for events and the root reads its stderr separately.

### Toolchain notes

Compiles as an included TU under gcc 11 / C++17. The only diagnostic is one
`-Wunused-function` (`output_format_str`, used by its own `main`), silenced for
this TU alone. `build.rs` adds `/utf-8` and `/bigobj` under `is_like_msvc()`,
matching what llama.cpp's own CMake does for every target: the file has
non-ASCII literals and 13.9k lines of case templates. Clang and MSVC are
untested here. Metal needs no extra headers -- the file reaches its Metal-only
path through `ggml_backend_reg_get_proc_address`.

The vendored tree is not pruned: `make engine-source` is a shallow clone of the
pinned tag, and `build.rs` asserts `tests/test-backend-ops.cpp` exists with a
message pointing at it. The prebuilt-bundle recipe (`engine-prebuilt.sh`) reads
`ARCHIVES`; the wrapper is built by `cc` on every build like the rest of the
shim and is deliberately not in `ARCHIVES`, so prebuilt bundles are unaffected.

## Root and leaf

**The root (`--diagnose`) returns before `load_backend_modules()` is ever
called.** It holds no ggml and no GPU context, so no kernel can take it down.
It probes devices and the op list, builds a plan, then runs one leaf per
(device, op family), emitting events as it goes.

**The leaf (`--diagnose-run <device>`)** loads the backend modules from its own
directory -- the same working-directory pinning and `llamacpp_env` the serving
engine uses, so it tests exactly the modules Jan runs -- executes one family on
one device, and prints `DiagEvent` lines.

One leaf per family is the unit because that is the blast radius worth buying.
Backend init costs 0.3-0.4 s and there are ~150 families, so per-family
spawning costs about a minute per device against an 11-15 minute full run, and
in exchange a `GGML_ASSERT` or a device loss costs one family: the root records
it as `crashed` and moves on.

**The root never touches the serving engine.** It holds no registry, opens no
preset and speaks to no worker port, so a leaf crash cannot unload a model the
user has resident.

Cancellation is stdin close, the same signal the serving worker uses. The root
`std::process::exit(0)`s when finished rather than returning: the cancel
watcher is a blocking stdin read, and tokio waits for its blocking pool when
the runtime drops, so a parent still holding the pipe would keep a finished
root alive forever.

## Reading a gguf for the Model preset

`engine::model_plan` turns one gguf into a family list. It is Tauri-free and
outside the `engine` feature, so it is unit-tested with no C++ toolchain.

`ModelShape::from_gguf` reads architecture, head sizes and expert count from
the metadata, and the weight types off the **tensor block** via
`gguf::helpers::read_gguf_tensor_types` -- a second visitor over the walk
`find_gguf_tensors` already does, not a second parser.

**Weight types come from the tensors, not `general.file_type`.** A file type
names a *recipe*, not a type: Q4_K_M is q4_K for most attention and
feed-forward weights, q6_K for output and some feed-forward-down, q5_K
elsewhere, f32 for the norms -- and llama.cpp's mixture rules have changed
repeatedly. Walking the tensor block costs one pass over a few hundred KB of
names and cannot be wrong. On `qwen-3.8.27b-iq4_xs.gguf` the tensors report
`f32, q8_0, q4_K, q5_K, q6_K, iq4_xs`: four more types than the file type alone
implies, each with its own kernel.

The caller builds the plan, not the root: reading a gguf needs a model path,
and the root deliberately holds no model. It arrives as `--diagnose-plan <json>`.

## The Tauri layer

`engine/diagnose_commands.rs` exposes `start_diagnostics(preset, devices, envs,
model)` and `cancel_diagnostics(job)`, republishing each root line as a
`llamacpp-diagnostics` event tagged with a job id.

One run at a time, enforced in the plugin: the check saturates every core, so a
second concurrent run would make both unreliable and the timings meaningless.
A job id is still carried because events from a superseded run can be in flight
when a new one starts.

A terminal `done` is emitted on every path, including a root that could not be
started, so a listener never waits forever.

## Tests

`tests/diagnose_root.rs` drives the root against generated stand-in leaves
(shell scripts, so no second binary) that exit cleanly, exit nonzero, stop
without saying `done`, hang, and print garbage. Real processes, because
`crashed` and `hung` are things an OS does to a child. It needs no `engine`
feature, which is itself the check that the root links no ggml.
