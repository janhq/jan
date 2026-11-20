# Measurements

One machine, one run each, so read these as orders of magnitude rather than
benchmarks. **Check the build profile before comparing two rows** -- a debug
`test-backend-ops` is several times slower than a release one, which is the
easiest way to misread this page.

**Reference machine:** 8 threads, Intel CPU (ggml picked the `sapphirerapids`
variant), NVIDIA RTX 3090 (24 GiB), Ubuntu 22.04, gcc 11.4, ccache warm for
ggml. Engine llama.cpp b12110.

Devices available here: **CPU**, **CUDA0** (RTX 3090), **Vulkan0** (same card).
No Metal, ROCm, or Windows figures.

Nothing failed on this machine, so the FAIL path was exercised by unit tests
only.

## Binary size

`jan-llama-worker`, stripped. The wrapper compiles to a 3.2 MB archive (1.3 MB
of text) with no link-time dependency beyond ggml; LTO drops what nothing
calls, so the figure depends on whether the entry points are referenced.

| Variant | Without wrapper | Linked, entry points unused | Linked and called | Delta |
|---|---|---|---|---|
| cpu | 14,390,432 B | 14,417,592 B (+27 KB) | 15,698,008 B | +1.31 MB (+9.1%) |
| vulkan | not built | 14,420,440 B | not built | expected the same ~+1.3 MB; the TU uses only ggml-base symbols, so it does not depend on the backend |

Backend modules (`libggml-*.so`) are separate files and are unchanged.

## Build time

| Step | Time |
|---|---|
| cpu, `cargo build --release --features engine --bin jan-llama-worker` (baseline, no wrapper, ggml/llama via ccache) | 3m23s |
| Wrapper TU alone, `g++ -O2` | 40 s (0.86 GB RSS) |
| Wrapper TU alone, `g++ -O0` | 18 s |
| Touch `jan_llama_diag.cpp`, rebuild worker (cc at opt 3 + fat LTO relink) | 88 s |
| Upstream's own `test-backend-ops`, unmodified, `g++ -O2`, for reference | 48 s |
| vulkan, `cargo test --release --features engine-vulkan --no-run` (all test bins, first Vulkan build in this tree) | 6m22s |

The wrapper is the single heaviest C++ translation unit in the shim (13.9k
lines of templates) and is rebuilt only when it or the upstream file changes.

## Case counts

`diag_ops_json`, test mode, pinned b12110: 163 entries, 150 with tests, 13
without. Total **26,751 cases**. Counting is graph construction only: 50 ms.

Upstream's `--list-ops` reports 130 operations and `--show-coverage` 123
testable, 110 covered, 13 untested (ADD1, ADD_REL_POS, CUSTOM, DIAG_MASK_ZERO,
FLASH_ATTN_BACK, GET_REL_POS, IM2COL_BACK, MAP_CUSTOM1-3, POOL_2D_BACK,
WIN_PART, WIN_UNPART). Our listing has more entries because it keys on
`op_desc`, so fusion cases get their own families (`MUL_MAT_VEC_FUSION`,
`TOPK_MOE`, `RMS_NORM_MUL_ROPE`, ...), which the coverage report drops.

| Family | Cases | | Family | Cases |
|---|---|---|---|---|
| FLASH_ATTN_EXT | 5439 | | SET_ROWS | 767 |
| CONV_2D | 3144 | | TOPK_MOE | 672 |
| MUL_MAT | 3091 | | CPY | 642 |
| IM2COL_3D | 2051 | | TOP_K | 533 |
| MUL_MAT_VEC_FUSION | 1754 | | ROPE | 470 |
| OUT_PROD | 1543 | | ROPE_BACK | 404 |
| MUL_MAT_ID | 1182 | | everything else (137 tested families) | 5,059 |

Typical small families: ADD 173, MUL 143, SUB 142, SOFT_MAX 214, GET_ROWS 248.

## Whole-run time

Debug build unless marked. Each family is a separate leaf process, `-j 8`.

| Run | Device | Cases run | Not supported | Wall time |
|---|---|---|---|---|
| Support probe, all families | CPU | 19,828 | 3,239 | 0.3 s |
| Support probe, all families | CUDA0 | 16,228 | 6,839 | 0.4 s |
| Support probe, all families | Vulkan0 | 18,623 | 4,444 | 0.4 s |
| **Full**, 150 families | CPU (vs CPU reference) | 23,512 | 3,239 | **14m46s** |
| **Full**, 150 families | CUDA0 | 19,306 | 7,445 | **11m03s** |

Slowest families at `-j 8`, CUDA0: MUL_MAT_ID 121 s, FLASH_ATTN_EXT 97 s,
MUL_MAT_ID_FUSION 81 s, MUL_MAT 80 s, GET_ROWS 54 s. CPU: FLASH_ATTN_EXT 168 s,
MUL_MAT_ID 133 s, MUL_MAT 100 s, MUL_MAT_ID_FUSION 85 s.

## Filter effectiveness

CPU device only, **release** `test-backend-ops`, `-j 8`. Cases are those
actually run in test mode.

| Family | Filter | Cases | Seconds |
|---|---|---|---|
| MUL_MAT | none | 2633 | 101.8 |
| MUL_MAT | Quick (`type_a=(f16\|f32\|bf16\|q4_0\|q8_0\|q2_K\|q3_K\|q4_K\|q5_K\|q6_K\|iq4_xs\|mxfp4),`) | 1731 | 49.9 |
| MUL_MAT | model, Q4_K_M (`type_a=(q4_K\|q6_K\|f16\|f32),`) | 842 | 18.6 |
| MUL_MAT_ID | none | 1184 | 149.0 |
| MUL_MAT_ID | Quick | 672 | 37.1 |
| MUL_MAT_ID | model, Q4_K_M | 110 | 5.0 |
| FLASH_ATTN_EXT | none | 5441 | 185.7 |
| FLASH_ATTN_EXT | Quick (`hsk=(64\|128),hsv=(64\|128),`) | 789 | 22.3 |
| FLASH_ATTN_EXT | model, head size 128 | 575 | 19.5 |

Quick buys the three heavy families for about 110 s on this machine. The Model
preset covers them for about 43 s, or 38 s for a dense model, which skips
`MUL_MAT_ID` entirely.

## Notes

- `ADD` costs about 19 s on every device at `-j 1`. Likely (not profiled) the
  CPU reference run (`ggml_backend_cpu_set_use_ref`) plus tensor initialisation
  dominating, since the GPU and the CPU device take the same time. **A GPU does
  not make a test run fast.**
- A bad `-p` regex throws `std::regex_error` out of `test_backend`; the wrapper
  catches it and reports `done {ok: false, error}`.
- Upstream's `show_test_coverage` loop aborts
  (`GGML_ASSERT(!use_weight_context())`) and segfaults on fusion cases if copied
  naively; `jan_llama_diag_ops_json` builds graphs the way `eval` does instead.
