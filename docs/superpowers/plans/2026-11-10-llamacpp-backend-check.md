# llama.cpp Backend Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user whose model fails or outputs garbage on the bundled llama.cpp can run a check from Settings > Llama.cpp that runs ggml backend op tests on the engine and device Jan actually uses, and copy a report naming each failing or crashing op, the device and the engine pin. Tracks janhq/jan-internal#520.

**Architecture:** The check is a new one-shot mode of the existing `jan-llama-worker` (`--check-backend`), the same way `--list-devices` already is. A new C++ TU in `shim/` compiles upstream `tests/test-backend-ops.cpp` from the pinned source tree and drives its test cases one at a time, printing a JSON line before and after each case. The desktop side spawns that worker, folds the lines into a report, and when the worker dies on a `GGML_ASSERT` the case that started without finishing is the crash; it is recorded and the worker is respawned from the next case. By default the cases are the ops of the user's own model graph (built from GGUF metadata only, no weights), not the 10k+ upstream eval set.

**Tech Stack:** C++17 (cc crate, pinned llama.cpp b12110), Rust (tauri-plugin-llamacpp, tokio, `tauri::ipc::Channel`), TypeScript (guest-js, llamacpp-extension), React + vitest (web-app), MDX docs.

## Global Constraints

- Engine pin stays `b12110` / `cd959bae99ff4bed22bef2604f45241c09bbb8c8` (`build.rs:16-19`). No second engine version, no worker-path setting, no hosted binaries (issue scope "Out").
- No new shipped binary: the check lives in `jan-llama-worker`, so `tauri.{linux,macos,windows}.conf.json` resources, `stage-engine.sh`, `sign-engine.sh` and the `engine-build.yml` artifacts stay unchanged.
- The check runs in a child process; a `GGML_ASSERT` abort in it must be reported as a failure, never take Jan down.
- The report must contain the engine `version`, `tag`, `build_number`, `commit` from `get_engine_version` (`engine/commands.rs:641-666`).
- Commits follow `~/.omp/agent/AGENTS.md`: one domain per commit, backend/contract before UI, plain `-` dashes and `->` arrows only.
- Public text (docs, PR bodies) carries no internal details; nothing is posted to GitHub without Thinh's approval.

## Decisions (answers to the issue's open design questions)

| Question | Decision | Why |
|---|---|---|
| Ship upstream `test-backend-ops` binary, or reproduce inside worker/shim? | Compile upstream `tests/test-backend-ops.cpp` into the worker via a driver TU that `#include`s it; do not ship upstream's `main`. | Upstream binary prints a test's result only after compute (`test-backend-ops.cpp:1587-1597` at b12110), so on an abort there is no record of which op died. Our driver prints `start` before compute. No extra binary to stage, bundle-list and sign per variant. Upstream's test cases are reused, not reproduced. |
| Which ops and modes? | `test` mode only. Default op set = unique ops of the selected model's prompt + generation graphs (upstream `test-export-graph-ops` technique, `llama_graph_reserve`). Optional "all ops" = upstream `make_test_cases_eval()`. Optional op regex for reruns. | A model's graph is a few hundred unique cases, minutes not hours; it answers "why does *this* model fail". `perf`/`grad` say nothing about correctness. |
| Where in the UI? | Button "Check backend" in `LlamacppEngineInfo` (Settings > Llama.cpp, beside version/build/commit) opening a dialog; plus a "Check backend" action on the backend-error toast in `LlamacppOomListener` preselecting the failed model. | Users land in one of those two places after a failure. |
| Output / what users paste? | A Markdown block built in Rust: Jan + engine pin, OS, device + backend, op source, counts, and a table of non-ok cases only. "Copy report" puts it on the clipboard. | One builder, unit-testable, identical in UI and logs. |
| CPU-only machines? | Allowed: device `CPU` is tested against the CPU reference implementation (`ggml_backend_cpu_set_use_ref`). Upstream skips CPU only because its default run has no backend filter. | A CPU variant picked by `ggml_backend_score` can be wrong too (#9177's offline commenter could not load any model). |

## Risks

- `test-backend-ops.cpp` changes often (last upstream change 2026-11-09) and the driver uses its internals (`test_case`, `printer`, `make_test_cases_eval`, `make_test_cases_from_file`). A pin bump that renames them breaks the worker compile, loudly, in `engine-build.yml`. Accepted: the fix is local to `jan_backend_check.cpp`.
- Compile time per variant grows by one ~14k-line TU (host C++, no nvcc). [INFERENCE: 1-3 min; measure in Task 1.]
- Graph ops are extracted on the CPU device with `n_ctx` capped (default 4096) so the KV cache of a 27B model is not allocated at full context. Op kinds and types match the user's preset (flash-attn, cache types, ubatch); KV-length shapes do not. The report says which `n_ctx` was used.
- A hung GPU (Vulkan DeviceLost) can stall a case instead of aborting; handled by a per-case timeout that kills the worker and records `timeout`.
- Running the check while a model serves shares the GPU; a driver reset could hit the serving worker. The command refuses while any generation is in flight (reuses `engine_slots_idle`).

## Data contract (shared by every task)

Worker CLI (one-shot, exits when done):

```text
jan-llama-worker --check-backend --device <ggml device name, e.g. Vulkan0|CUDA0|MTL0|CPU>
                 [--preset <router.preset.ini> --model-id <section>]   # model ops (default when given)
                 [--all-ops]                                           # upstream eval set instead
                 [--ops <regex>]                                       # op_names_filter, as upstream -o
                 [--start <case index>]                                # resume after a crash
                 [--max-ctx <n>]                                       # graph export cap, default 4096
```

Stdout: JSON Lines, schema `v` = 1, flushed per line.

```json
{"v":1,"event":"plan","device":"Vulkan0","device_description":"AMD Radeon RX 7900 XTX","backend":"Vulkan","source":"model","model":"qwen3.8-27b-iq3_s","n_ctx":4096,"total":412}
{"v":1,"event":"start","i":17,"op":"MUL_MAT","params":"type_a=iq3_s,type_b=f32,m=4096,n=1,k=5120,..."}
{"v":1,"event":"result","i":17,"status":"fail","error":"compare failed"}
{"v":1,"event":"done"}
```

`status` is one of `ok | fail | unsupported | skipped` (upstream `test_status_t`). The desktop adds `crashed` and `timeout`, which the worker can never print.

Exit codes: `0` finished (failures are data, not an exit code), `2` bad args (existing), `3` pin mismatch (existing), `8` device not found, `9` model graph export failed (message on stderr). An abort is whatever the OS reports (`describe_exit`, `engine/worker.rs:324`).

---

### Task 1: C++ check driver compiled into the shim

**Files:**
- Create: `src-tauri/plugins/tauri-plugin-llamacpp/shim/jan_backend_check.cpp`
- Modify: `src-tauri/plugins/tauri-plugin-llamacpp/shim/jan_llama_shim.h` (new C ABI after `jan_llama_commit`, line 108)
- Modify: `src-tauri/plugins/tauri-plugin-llamacpp/shim/jan_llama_shim.cpp:425-520` (extract preset -> `common_params` into a reusable function)
- Modify: `src-tauri/plugins/tauri-plugin-llamacpp/build.rs:1071-1088` (`compile_shim`: add the file and include dirs)

**Interfaces:**
- Produces (C ABI):

```c
// One JSON line per call (no trailing newline), valid only for the call.
typedef void (*jan_check_line_cb)(const char * line, void * user_data);

// Runs backend op tests on `device` (a ggml device name). `ini_path` +
// `preset_name` select model-graph ops; both NULL with all_ops=1 selects the
// upstream eval set. `ops_regex` NULL = no filter. Cases before `start` are
// skipped. Returns 0 when every case ran, 8 unknown device, 9 export failed;
// `err` holds the reason for non-zero.
int jan_backend_check_run(const char * device,
                          const char * ini_path,
                          const char * preset_name,
                          int          all_ops,
                          const char * ops_regex,
                          size_t       start,
                          unsigned     max_ctx,
                          jan_check_line_cb on_line,
                          void *       user_data,
                          char *       err,
                          size_t       err_len);
```

- Produces (C++ internal, in `jan_llama_shim.cpp`): `bool jan_params_from_preset(const char * ini_path, const char * preset_name, common_params & out, std::string & err);` - the body of today's `jan_llama_engine_start_from_preset` lines 440-520 moved verbatim (pctx defaults, `load_ini_presets`, n_threads fix, `-mmdev`, tensor_buft_overrides slots, kv_overrides terminator, reasoning default). `jan_llama_engine_start_from_preset` then calls it, so engine start behaviour is unchanged.

- [ ] **Step 1: Extract `jan_params_from_preset`.** Move lines 440-520 of `jan_llama_shim.cpp` into the function above; `jan_llama_engine_start_from_preset` becomes `if (!jan_params_from_preset(ini_path, preset_name, engine->params, msg)) { set_err(err, err_len, msg.c_str()); return nullptr; }` followed by its remaining code. Declare it in a new internal header `shim/jan_llama_shim_internal.h` (C++ only, not part of the C ABI).

- [ ] **Step 2: Run the existing engine tests to prove the move is behaviour-neutral.**

Run: `cd src-tauri/plugins/tauri-plugin-llamacpp && cargo test --features engine --test engine_smoke --test worker_http`
Expected: PASS, same as before the change.

- [ ] **Step 3: Write `jan_backend_check.cpp`.** Structure:

```cpp
// Upstream's test cases, compiled in rather than shipped as a binary: its own
// main prints a case only after compute, so an abort leaves no trace of which
// op died. This driver prints `start` first. Upstream main is renamed away.
#define main jan_upstream_test_backend_ops_main
#include "test-backend-ops.cpp"   // tests/ dir is on the include path
#undef main

#include "jan_llama_shim.h"
#include "jan_llama_shim_internal.h"
#include "llama.h"
#include "llama-ext.h"            // llama_graph_reserve (src/)
#include "gguf.h"
#include <nlohmann/json.hpp>

namespace {

// Records the last result instead of printing; status comes from eval().
struct capture_printer : printer {
    std::string error;
    void print_test_result(const test_result & r) override { error = r.error_message; }
};

void emit(jan_check_line_cb cb, void * ud, const nlohmann::json & j) {
    const std::string s = j.dump();
    cb(s.c_str(), ud);
}

const char * status_name(test_status_t s) {
    switch (s) {
        case test_status_t::OK:            return "ok";
        case test_status_t::FAIL:          return "fail";
        case test_status_t::NOT_SUPPORTED: return "unsupported";
        default:                           return "skipped";
    }
}

// op name without running anything: build the graph in a scratch no_alloc ctx.
std::string op_name_of(test_case & t) {
    ggml_init_params p = { ggml_tensor_overhead() * 128 + ggml_graph_overhead(), nullptr, true };
    ggml_context_ptr ctx(ggml_init(p));
    ggml_tensor * out = t.build_graph(ctx.get());
    return out ? t.op_desc(out) : std::string("?");
}

// Upstream test-export-graph-ops, on a local GGUF and Jan's own preset:
// metadata only (no weights), CPU device, n_ctx capped. Writes the upstream
// test-file format so make_test_cases_from_file reads it unchanged.
bool export_model_ops(const char * ini, const char * name, unsigned max_ctx,
                      std::string & out_path, std::string & model_label,
                      unsigned & n_ctx_used, std::string & err);
}  // namespace

extern "C" int jan_backend_check_run(/* see header */) {
    // 1. find device by name: ggml_backend_dev_by_name(device); none -> 8.
    // 2. cases = all_ops ? make_test_cases_eval()
    //                    : make_test_cases_from_file(exported path)   (export fail -> 9)
    // 3. backend = ggml_backend_dev_init(dev); cpu_ref = CPU backend with
    //    ggml_backend_cpu_set_use_ref(true) via proc address, as upstream does.
    // 4. emit plan {device, device_description, backend reg name, source, model, n_ctx, total}
    // 5. for i in [start, cases.size()):
    //      emit start {i, op: op_name_of(*c), params: c->vars()}
    //      status = c->eval(backend, cpu_ref, ops_regex, &capture)
    //      emit result {i, status, error}
    // 6. emit done; return 0
}
```

`export_model_ops` copies upstream `extract_graph_ops` + `test_object::serialize` (`tests/test-export-graph-ops.cpp:25-125` at b12110) and replaces its model load with: `jan_params_from_preset` -> `gguf_init_from_file(params.model.path, {no_alloc=true})` -> `llama_model_init_from_user(gguf, noop_setter, nullptr, mparams{devices={CPU,nullptr}, no_alloc=true})` -> `llama_init_from_model` with `n_ctx = min(params.n_ctx or model train ctx, max_ctx)`, `n_ubatch`, `n_batch`, `flash_attn_type` (auto -> enabled), `type_k`, `type_v`, `n_seq_max` from params -> `llama_graph_reserve` for pp (`n_tokens = min(n_ctx, n_ubatch)`) and tg (`n_seqs`). The test file goes to `std::filesystem::temp_directory_path() / ("jan-check-" + pid + ".txt")`, removed before return. A multimodal projector (`mmproj`) is not exported; the report says text graph only.

- [ ] **Step 4: Declare the ABI in `jan_llama_shim.h`** exactly as in Interfaces.

- [ ] **Step 5: Wire `compile_shim` in `build.rs`.**

```rust
cc.cpp(true)
    .std("c++17")
    .file("shim/jan_llama_shim.cpp")
    .file("shim/jan_backend_check.cpp")
    // ...existing includes...
    .include(src.join("tests"))   // test-backend-ops.cpp
    .include(src.join("src"));    // llama-ext.h
```

and `println!("cargo:rerun-if-changed=shim/jan_backend_check.cpp");` plus the internal header next to the existing `rerun-if-changed` lines (`build.rs:271-272`).

- [ ] **Step 6: Build the worker and record the compile-time delta.**

Run: `make engine-source && cd src-tauri/plugins/tauri-plugin-llamacpp && time cargo build --release --features engine-metal --bin jan-llama-worker`
Expected: builds; note the time against a build of `origin/main` for the PR body.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/plugins/tauri-plugin-llamacpp/shim src-tauri/plugins/tauri-plugin-llamacpp/build.rs
git commit -m "feat(engine): compile a backend op check driver into the shim"
```

### Task 2: `--check-backend` mode in `jan-llama-worker`

**Files:**
- Modify: `src-tauri/plugins/tauri-plugin-llamacpp/src/bin/jan-llama-worker.rs:30-131`
- Modify: `src-tauri/plugins/tauri-plugin-llamacpp/src/engine/sys.rs` (safe wrapper over `jan_backend_check_run`, next to `devices_json`)
- Test: `src-tauri/plugins/tauri-plugin-llamacpp/tests/engine_smoke.rs`

**Interfaces:**
- Consumes: `jan_backend_check_run` (Task 1).
- Produces: `pub fn Engine::check_backend(opts: &CheckOptions, on_line: impl FnMut(&str)) -> Result<(), CheckError>` in `sys.rs`, where

```rust
pub struct CheckOptions {
    pub device: String,
    pub preset: Option<(String, String)>, // (ini path, section)
    pub all_ops: bool,
    pub ops_regex: Option<String>,
    pub start: usize,
    pub max_ctx: u32,
}
pub enum CheckError { UnknownDevice(String), Export(String) }
```

- [ ] **Step 1: Write the failing smoke test** (feature `engine`, same harness as the existing smoke tests: spawn the built worker binary).

```rust
#[test]
fn check_backend_on_cpu_reports_one_line_per_case() {
    let out = worker_cmd()
        .args(["--check-backend", "--device", "CPU", "--all-ops", "--ops", "^ADD$"])
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let lines: Vec<serde_json::Value> = String::from_utf8_lossy(&out.stdout)
        .lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(lines[0]["event"], "plan");
    let total = lines[0]["total"].as_u64().unwrap() as usize;
    let starts = lines.iter().filter(|l| l["event"] == "start").count();
    let results = lines.iter().filter(|l| l["event"] == "result").count();
    assert_eq!(starts, total);
    assert_eq!(results, total);                 // every start is closed
    assert_eq!(lines.last().unwrap()["event"], "done");
}

#[test]
fn check_backend_names_an_unknown_device() {
    let out = worker_cmd().args(["--check-backend", "--device", "NOPE0", "--all-ops"]).output().unwrap();
    assert_eq!(out.status.code(), Some(8));
}
```

Note: `--ops ^ADD$` filters inside `eval`, so filtered-out cases come back `skipped`; the test asserts pairing, not counts of `ok`.

- [ ] **Step 2: Run, expect FAIL** (`unknown flag: --check-backend`, exit 2).

Run: `cargo test --features engine --test engine_smoke check_backend -- --nocapture`

- [ ] **Step 3: Implement.** In `Args` add `check_backend: bool, device: Option<String>, model_id: Option<String>, all_ops: bool, ops: Option<String>, start: usize, max_ctx: u32 (default 4096)`; parse in `parse_args` beside `--list-devices`. In `main`, after `load_backend_modules()` and before the `list_devices` branch:

```rust
if args.check_backend {
    let opts = CheckOptions { /* from args; preset = args.preset.zip(args.model_id) */ };
    let mut stdout = std::io::stdout().lock();
    let res = Engine::check_backend(&opts, |line| {
        use std::io::Write;
        let _ = writeln!(stdout, "{line}");
        let _ = stdout.flush();               // a crash must not lose the `start` line
    });
    match res {
        Ok(()) => std::process::exit(0),
        Err(CheckError::UnknownDevice(d)) => { eprintln!("jan-llama-worker: no device {d}"); std::process::exit(8) }
        Err(CheckError::Export(e)) => { eprintln!("jan-llama-worker: could not read the model graph: {e}"); std::process::exit(9) }
    }
}
```

Validation in `parse_args`: `--check-backend` requires `--device`, and exactly one of `--all-ops` or `--preset`+`--model-id`; violations exit 2 with a message.

- [ ] **Step 4: Run, expect PASS.** Same command as Step 2.

- [ ] **Step 5: Manual model-graph run on a real GPU** (Metal here; Vulkan/CUDA box for the PR):

Run: `src-tauri/resources/bin/jan-llama-worker --check-backend --device MTL0 --preset "$HOME/Library/Application Support/Jan/data/llamacpp/router.preset.ini" --model-id <a downloaded model id>`
Expected: a `plan` line with `source:"model"` and a few hundred `total`, then paired start/result lines, then `done`. Record wall time for the PR body.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(engine): add --check-backend to jan-llama-worker"
```

### Task 3: Supervisor, report builder and Tauri command

**Files:**
- Create: `src-tauri/plugins/tauri-plugin-llamacpp/src/engine/check.rs`
- Modify: `src-tauri/plugins/tauri-plugin-llamacpp/src/engine/mod.rs:17-26` (`pub mod check;`)
- Modify: `src-tauri/plugins/tauri-plugin-llamacpp/src/engine/commands.rs` (`run_backend_check`, `cancel_backend_check`)
- Modify: `src-tauri/plugins/tauri-plugin-llamacpp/src/state.rs` (slot for the running check's child)
- Modify: `src-tauri/plugins/tauri-plugin-llamacpp/src/lib.rs` (register commands)
- Modify: `src-tauri/plugins/tauri-plugin-llamacpp/build.rs:21-48` (`COMMANDS`), `permissions/default.toml`
- Modify: `src-tauri/plugins/tauri-plugin-llamacpp/guest-js/index.ts`, `guest-js/types.ts`

**Interfaces:**
- Consumes: worker CLI and JSONL contract (Task 2); `resolve_worker_exe`, `worker::worker_cwd`, `jan_utils::system::setup_windows_process_flags`, `worker::describe_exit`, `worker::classify_fault`, the Windows kill-on-close job object from `worker.rs`, `get_engine_version`, `engine_slots_idle`.
- Produces:

```rust
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackendCheckRequest {
    pub device: String,
    pub model_id: Option<String>,   // None -> all ops
    pub preset_path: Option<String>,
    pub ops_regex: Option<String>,
    pub envs: HashMap<String, String>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum CaseStatus { Ok, Fail, Unsupported, Skipped, Crashed, Timeout }

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CheckEvent {               // streamed over tauri::ipc::Channel
    Plan { device: String, description: String, backend: String, source: String, model: Option<String>, n_ctx: Option<u32>, total: usize },
    Progress { index: usize, op: String },
    Case { index: usize, op: String, params: String, status: CaseStatus, detail: String },
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackendCheckReport {
    pub plan: Option<CheckEvent>,    // the Plan event
    pub counts: BTreeMap<String, usize>, // status -> count
    pub problems: Vec<CheckEvent>,   // Case events with fail|crashed|timeout
    pub unsupported: Vec<String>,    // "OP(params)"
    pub stopped_early: Option<String>, // cancelled / too many crashes
    pub markdown: String,            // what "Copy report" copies
}

#[tauri::command] pub async fn run_backend_check<R: Runtime>(app: AppHandle<R>, state: State<'_, Arc<LlamacppState>>, request: BackendCheckRequest, on_event: Channel<CheckEvent>) -> Result<BackendCheckReport, String>;
#[tauri::command] pub async fn cancel_backend_check(state: State<'_, Arc<LlamacppState>>) -> Result<(), String>;
```

- guest-js: `runBackendCheck(request, onEvent): Promise<BackendCheckReport>` (creates the `Channel`, as `tauri-plugin-extensions/guest-js/index.ts:203` does) and `cancelBackendCheck()`.

Design of `check.rs`, split so the logic is testable without a process:

- `struct Fold` - pure state machine. `fn line(&mut self, json: &str) -> Vec<CheckEvent>`; `fn exited(&mut self, status_text: String, stderr_tail: &[String]) -> Resume` where `enum Resume { Done, From(usize), Stop(String) }`. Rule: a `start` without its `result` when the process exits is `Crashed` with detail `"{describe_exit}: {last stderr line classify_fault marks, else last stderr line}"`, and resume is `From(i + 1)`. Exit 0 with no pending start is `Done`. A non-zero exit before `plan` is `Stop(stderr)` (exit 8/9 messages surface verbatim). More than `MAX_CRASHES = 25` crashes is `Stop("stopped after 25 crashes")`.
- `fn timeout_hit(&mut self) -> Resume` - pending start becomes `Timeout`, resume `From(i + 1)`. Per-case timeout `CASE_TIMEOUT = 120s` from the `start` line.
- `fn render_markdown(report, engine: &EngineVersion, app_version: &str, os: &str) -> String` - the paste format:

```markdown
### Jan backend check
- Jan 0.9.0, llama.cpp 0.9.0 (b12110, cd959bae)
- OS: macOS 15.5 (arm64)
- Device: MTL0 - Apple M3 Max (Metal)
- Ops: model `qwen3.8-27b-iq3_s` (text graph, n_ctx 4096), 412 cases
- Result: 398 ok, 2 fail, 1 crashed, 0 timeout, 11 unsupported

| Op | Params | Result | Detail |
|---|---|---|---|
| MUL_MAT | type_a=iq3_s,type_b=f32,m=4096,n=1,k=5120 | fail | compare failed |
| SOFT_MAX | type=f32,ne=[...] | crashed | killed by SIGABRT: ggml-metal.m:1234: GGML_ASSERT(...) failed |

<details><summary>11 unsupported (run on CPU instead, not a failure)</summary>
...
</details>
```

- Spawner loop in `run_backend_check`: refuse with `"a model is generating; try again when it finishes"` if `engine_slots_idle(None)` is false; refuse if a check is already running. Then loop: build `tokio::process::Command` exactly as `engine_devices` does (`commands.rs:365-374`: `resolve_worker_exe`, `worker_cwd`, `envs`, piped stdio, `setup_windows_process_flags`) plus the kill-on-close job object; args from the request (`--preset`/`--model-id` when `model_id` is set, else `--all-ops`; `--start n`); read stdout lines -> `Fold::line` -> send events on the channel; keep the last 20 stderr lines; `select!` on line, exit, `CASE_TIMEOUT`, cancel. On `Resume::From(n)` respawn; on `Done`/`Stop` build the report, `log::info!` its counts and `log::warn!` each problem row so `app.log` carries the same facts.

- [ ] **Step 1: Write the failing unit tests in `check.rs`** (pure `Fold`, no process):

```rust
#[test]
fn a_start_without_result_at_exit_is_the_crash_and_resume_skips_it() {
    let mut f = Fold::default();
    f.line(r#"{"v":1,"event":"plan","device":"Vulkan0","device_description":"RX 7900","backend":"Vulkan","source":"model","model":"m","n_ctx":4096,"total":3}"#);
    f.line(r#"{"v":1,"event":"start","i":0,"op":"ADD","params":"a"}"#);
    f.line(r#"{"v":1,"event":"result","i":0,"status":"ok","error":""}"#);
    f.line(r#"{"v":1,"event":"start","i":1,"op":"SOFT_MAX","params":"b"}"#);
    let resume = f.exited("killed by SIGABRT".into(), &["ggml-vulkan.cpp:99: GGML_ASSERT(x) failed".into()]);
    assert_eq!(resume, Resume::From(2));
    let p = &f.report().problems[0];
    assert!(matches!(p, CheckEvent::Case { index: 1, status: CaseStatus::Crashed, .. }));
    assert!(format!("{p:?}").contains("GGML_ASSERT"));
}

#[test]
fn a_respawned_run_keeps_earlier_results_and_counts() { /* plan again with same total, start at 2, result ok, done, exit 0 -> Done; counts ok=2 crashed=1 */ }

#[test]
fn a_failure_before_plan_stops_with_the_workers_message() { /* exited("exit code 9", ["could not read the model graph: x"]) -> Stop containing that text */ }

#[test]
fn too_many_crashes_stop_the_run() { /* 26 start-then-exit cycles -> Stop("stopped after 25 crashes") */ }

#[test]
fn a_timeout_marks_the_pending_case_and_resumes_after_it() { /* start i=4, timeout_hit -> From(5), status Timeout */ }

#[test]
fn the_report_names_the_engine_pin_and_lists_only_problems() {
    // render_markdown with one ok, one fail, one unsupported:
    // contains "llama.cpp 0.9.0 (b12110, cd959bae)", a "| fail |" row,
    // no row for the ok case, unsupported only inside <details>.
}
```

- [ ] **Step 2: Run, expect FAIL** (module missing).

Run: `cd src-tauri/plugins/tauri-plugin-llamacpp && cargo test --lib engine::check`

- [ ] **Step 3: Implement `Fold`, `render_markdown`, the spawner loop and both commands.** Register in `lib.rs`, `COMMANDS`, `permissions/default.toml` (`allow-run-backend-check`, `allow-cancel-backend-check`), add guest-js wrappers and types.

- [ ] **Step 4: Run, expect PASS.** Same command as Step 2.

- [ ] **Step 5: Supervisor test against a stand-in worker** (unix, same pattern as `worker.rs:1336` "A stand-in worker: a shell script"): a script that prints `plan` + `start i=0`, then `kill -ABRT $$` when `--start` is absent, and prints `start 1`/`result 1 ok`/`done` when `--start 1` is given. Assert the command-level loop returns counts `{crashed:1, ok:1}` and that the crashed row's detail contains `SIGABRT`. This covers the respawn path the pure tests cannot.

Run: `cargo test --lib engine::check -- --nocapture`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(engine): run_backend_check command with crash attribution and report"
```

### Task 4: Extension and service layer

**Files:**
- Modify: `extensions/llamacpp-extension/src/index.ts` (beside `getEngineVersion`, line 1051, and `getDevices`, line 2964)
- Modify: `web-app/src/services/models/types.ts:197`, `web-app/src/services/models/default.ts:737`
- Test: `extensions/llamacpp-extension/src/__tests__/` (existing test dir; follow its mocking of `@janhq/tauri-plugin-llamacpp-api`)

**Interfaces:**
- Consumes: guest-js `runBackendCheck`, `cancelBackendCheck` (Task 3).
- Produces:
  - Extension: `runBackendCheck(opts: { device: string; modelId?: string; opsRegex?: string }, onEvent: (e: CheckEvent) => void): Promise<BackendCheckReport>` - builds `envs` exactly as `getDevices` does (`parseEnvFromString(envs, this.llamacpp_env)`), calls `refreshEnginePreset()` when `modelId` is set so the preset section exists, passes the preset path it already uses for `start_engine`. `cancelBackendCheck(): Promise<void>`.
  - `ModelsService.runBackendCheck(...)` / `cancelBackendCheck()` - same `getEngine('llamacpp')` duck-typing as `getEngineVersion` (`default.ts:737-760`); returns `null` on a build without the engine.

- [ ] **Step 1: Failing test** - `runBackendCheck({ device: 'Vulkan0', modelId: 'm' })` calls the plugin with the user's env string parsed into `envs`, with `modelId` and the preset path, and forwards channel events to `onEvent`.
- [ ] **Step 2: Run** `cd extensions/llamacpp-extension && yarn test` -> FAIL.
- [ ] **Step 3: Implement** the two methods and the service pass-through.
- [ ] **Step 4: Run** -> PASS.
- [ ] **Step 5: Commit** `feat(llamacpp-extension): expose the backend check` then `feat(web-app): backend check in the models service` (two commits, two domains).

### Task 5: Settings dialog and entry points

**Files:**
- Create: `web-app/src/containers/dialogs/BackendCheckDialog.tsx`
- Modify: `web-app/src/containers/LlamacppEngineInfo.tsx:56-100` ("Check backend" button)
- Modify: `web-app/src/containers/dialogs/LlamacppOomListener.tsx:38-50` (toast action "Check backend", preselecting the model whose request failed)
- Modify: `web-app/src/locales/*/settings.json` (or the namespace `LlamacppEngineInfo` already uses; every locale gets the English string where untranslated)
- Test: `web-app/src/containers/dialogs/__tests__/BackendCheckDialog.test.tsx`

**Interfaces:**
- Consumes: `serviceHub.models().runBackendCheck/cancelBackendCheck`, existing device list (`getDevices` via the hardware/llamacpp settings hook already used for device selection), downloaded llamacpp models from the models store.
- Produces: `<BackendCheckDialog open onOpenChange initialModelId? />`.

Dialog behaviour:
- Device select (engine devices + `CPU`), defaulting to the device in the user's llamacpp device setting, else the first GPU.
- Scope radio: "A model" (select of downloaded llamacpp models, default `initialModelId`) or "All ops (slow, can take an hour)".
- Running: progress bar `index / total`, current op name, Cancel.
- Done: summary counts, table of problem rows only, unsupported collapsed, "Copy report" (copies `report.markdown`), link to the docs section from Task 6.
- Errors from the command (busy, unknown device, export failed) shown inline, not as a toast.

- [ ] **Step 1: Failing component tests:** (a) after a mocked run resolving a report with one `fail` row, the row's op and "fail" render and "Copy report" writes `report.markdown` to the clipboard; (b) a mocked rejection `"a model is generating..."` renders inline and leaves Start enabled; (c) streaming a `Plan` then a `Progress` event shows `1 / 412`.
- [ ] **Step 2: Run** `cd web-app && yarn test BackendCheckDialog` -> FAIL.
- [ ] **Step 3: Implement** dialog, button, toast action, strings.
- [ ] **Step 4: Run** -> PASS; also `yarn test LlamacppEngineInfo` (existing tests must still pass).
- [ ] **Step 5: Verify the real surface.** `make dev`, open Settings > Llama.cpp, run a model check on Metal, confirm progress, the report, and that Copy pastes the Markdown. Force a crash path once by running with an env that makes the backend fail (e.g. `GGML_METAL_...` not available -> use the Task 3 stand-in via `JAN_LLAMA_WORKER_BIN`, which `resolve_worker_exe` already honours as the dev override) and confirm the crashed row and that Jan stays up.
- [ ] **Step 6: Commit** `feat(web-app): backend check dialog in llama.cpp settings`.

### Task 6: Docs and reply plan

**Files:**
- Modify: `docs/src/pages/docs/desktop/local-engine/llama-cpp.mdx` (new section "When a model fails on the bundled engine")
- Modify: `docs/src/pages/docs/desktop/remote-models/custom-endpoint.mdx` (link back from `#use-a-different-llamacpp-version`)
- Create (local only, not committed to `janhq/jan`): reply drafts for janhq/jan#9634, #9177, #9407 in the jan-internal#520 thread

Section content, in order: the engine is pinned and ships with the app (Settings > Llama.cpp shows version, build, commit); run Settings > Llama.cpp > Check backend on the failing model and attach the copied report plus `app.log`; update Jan first if the version is older than current (the Gemma 4 fixes in the issue's table landed between 0.8.8 and 0.9.0); to use another llama.cpp build, run your own `llama-server` and add it as a custom endpoint (existing anchor).

- [ ] **Step 1: Write the section and the cross-link.**
- [ ] **Step 2: Build docs** `cd docs && yarn build` -> no broken links.
- [ ] **Step 3: Commit** `docs(llamacpp): backend check and what to do when a model fails`.
- [ ] **Step 4: Draft the three replies, pick #9634 as canonical, and hand them to Thinh. Do not post.**

## Acceptance mapping (issue #520)

| Criterion | Where |
|---|---|
| Run a backend check from the app and copy a result naming failing ops and the device | Tasks 2, 3, 5 |
| Runs in a process a `GGML_ASSERT` cannot take Jan down with; abort reported as failure | Task 2 (worker mode), Task 3 (`Crashed` + respawn, stand-in test), Task 5 Step 5 |
| Result includes engine version, build, commit | Task 3 `render_markdown` + test |
| Docs say what to do | Task 6 |
| Reply plan for #9634, #9177, #9407 agreed, not posted | Task 6 Step 4 |

## Verification not in CI

- Vulkan and CUDA runs on real hardware (Windows + Linux): wall time for a model check on a 27B model, and that a `DeviceLost` shows as `crashed` or `timeout` rather than a hang. Record results in the PR body.
- Worker size and per-variant compile time delta (Task 1 Step 6).
