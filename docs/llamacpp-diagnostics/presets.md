# Presets and filters

Upstream has ~150 op families and 26,751 cases. Running all of them is 11-15
minutes per device, so every preset below is a choice about what to leave out
-- and the hazard of leaving things out is the subject of the second half of
this document.

A unit of work is one (device, op family) pair with an optional parameter
filter: `engine::diag::FamilyFilter { family, params }`, which is upstream's
`-o` plus its `-p`. All three presets travel the same path.

## Quick (the default)

The support probe over every family on each device, then test mode on
`model_plan::quick_families()`:

- **Small families, whole:** ADD, SUB, MUL, DIV, SCALE, NORM, RMS_NORM,
  SOFT_MAX, GET_ROWS, SET_ROWS, ROPE, CPY, CONT, CONCAT, SILU, GELU, SWIGLU,
  GEGLU. 61-767 cases each; cheap, and on every token's path.
- **MUL_MAT, MUL_MAT_ID, FLASH_ATTN_EXT**, narrowed to the types and head
  sizes real models use. Unfiltered these three are over half the total case
  count; a Quick check that skipped them would miss where a model spends almost
  all its time.

There is no `UNARY` family. Upstream keys on `op_desc`, so each unary op is its
own family -- the family-name guard below is what caught that.

## Full

The support probe plus every family `--diagnose-ops` reports at least one case
for. Minutes of 100% CPU on all cores; the UI warns before starting one, and on
Windows a long GPU kernel can trip the display driver's watchdog, which resets
the driver for every process.

## Model

The families one gguf's graph contains, at its own shapes. Offered after a
failed load as "Check why this model failed".

The caller builds the family list and passes it as `--diagnose-plan <json>`,
which implies this preset: reading a gguf needs a model path and the root
deliberately holds no model. See
[architecture.md](architecture.md#reading-a-gguf-for-the-model-preset).

## The support probe

Runs first on every preset, at `--workers 1` regardless -- it builds graphs and
asks whether the device supports them, and upstream threads test mode only. It
costs under half a second for the whole op list and is the only thing that
answers "which ops fall back to the CPU", so it is always worth its cost.

## The vacuous-pass guard

**Upstream's parameter strings are not a stable contract.** A filter that
silently matches nothing produces a run where every family reports `ok`, and
the user is told their hardware is fine on the strength of zero evidence. That
is the one wrong answer a diagnostic must never give, and narrowing by shape is
exactly what makes it likely.

Two guards, because the two dimensions fail at different times.

**Family names, before the run.** `diagnose::tested_families` intersects the
wanted list with `--diagnose-ops` on *every* preset, so a family upstream has
renamed or dropped is left out rather than passing vacuously. If the
intersection is empty the root exits with an error rather than running the
support probe alone and reporting a clean result. That error is written as a
`done` event on stdout as well as to stderr, so the panel names the reason
instead of reporting a bare early exit.

**Shapes, after the run.** These cannot be checked ahead of time, so the guard
is at the other end. `run_unit` classifies a leaf that exited cleanly, emitted
`done`, had no failure and reported `ok + not_supported == 0` as
`FamilyStatus::NoCases`. It then propagates on its own channel, never folded
into failure:

```
FamilyStatus::NoCases
  -> summary.families_no_cases
  -> done.inconclusive  (and done.ok becomes false)
  -> DiagnosticsRunStatus 'inconclusive'
  -> deviceVerdict 'inconclusive'
```

A family the run never reached travels the same way. A cancel or a passed
deadline leaves the families after it `FamilyStatus::Cancelled`, counted on
`summary.families_cancelled`, and `deviceVerdict` reads that -- along with a
device whose `summary` has not arrived at all -- as `inconclusive` too. The
families that did run say nothing about the ones that did not, so a partial
device must not report "Working correctly".

The verdict ordering is `failed` > `inconclusive` > `fallback` > `passed`: a
real failure still outranks an untested family, and an untested family always
outranks a pass.

Pinned by `a_filter_that_matches_nothing_is_inconclusive_not_a_pass` (root,
against a real stand-in process),
`a_family_the_device_does_not_implement_is_not_inconclusive` (not-supported is
a real answer, not a vacuous one), and two UI tests that assert a narrowed run
testing nothing never renders as a pass.

`model_plan` additionally fails **open** at every step: an unreadable head size
runs flash attention unfiltered rather than at a guessed geometry, and a file
whose tensor types are all unknown runs `MUL_MAT` unfiltered rather than
narrowed to the attention types, which would exercise none of the quantized
kernels the file actually uses. Over-running costs minutes; under-running costs
the answer.

## Why `--test-file` is not used

Upstream's `--test-file` reads a line-per-op file produced by a separate
`test-export-graph-ops` binary. It is strictly more exact than a regex over
parameter strings -- it serializes the real `ggml_cgraph` nodes (op, type,
`ne`, `op_params`, every source tensor's type/`ne`/`nb`) for the prompt and
generation graphs, and replays them. If it were cheap it would replace
`model_plan` outright.

It is not cheap, for three independent reasons, any one of which disqualifies
it:

1. **It loads the model.** `common_init_from_params` (or
   `llama_model_init_from_user` on the HF-fetch path) plus
   `llama_graph_reserve`. The pre-flight exists to explain a load that just
   *failed*; repeating the load inside the diagnostic is the thing being
   avoided, plus tens of seconds and the model's full size in RAM.
2. **It needs libllama and a private header.** `common.h`, `arg.h`,
   `llama-cpp.h`, `download.h` and `../src/llama-ext.h` -- the last internal to
   the llama.cpp build tree, not an installed header. The diag shim
   deliberately needs ggml headers only and links no libllama; this would put a
   model loader inside the leaf that exists to be a thin crash boundary.
3. **The cases it produces are untyped `test_generic_op`s.** No
   `max_nmse_err` override and no op-specific tolerance, so a FLASH_ATTN_EXT or
   a quantized MUL_MAT replayed this way is compared at the generic default.
   The curated cases are what encode upstream's knowledge of what "correct"
   means per op.

If exactness is ever needed, the right shape is to export the graph once at
*load* time from the worker that already has the model open and hand the file
to a leaf -- not to build a second model loader. That is separate work, and is
not needed to answer "is this machine's q4_K matmul kernel broken", which the
type filter answers directly.

## Known gaps

- `--diagnose-ops` reports case counts for the *unfiltered* list, so the root
  cannot know a unit will be empty before spawning it. Making it filter-aware
  needs a shim change and an engine rebuild to save ~0.4 s per empty unit;
  `NoCases` already gives the correct answer without it.
- Suggestions are drawn from the run alone, not from the failed load's
  `LoadDiagnostics`. Cross-referencing the two ("your preset asks for flash
  attention and this device's attention kernels are wrong") is a better
  sentence, but needs the structured error to reach the provider page, which it
  currently does not.
