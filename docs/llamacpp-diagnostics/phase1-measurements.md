# Phase 1 measurements: upstream test-backend-ops wrapper (#9639, epic #9637)

Engine llama.cpp b12110. Machine: 8 threads, Intel CPU (ggml picked the
`sapphirerapids` variant), NVIDIA RTX 3090 (24 GiB), Ubuntu 22.04, gcc 11.4,
ccache warm for ggml. Release profile (`opt-level z`, fat LTO). Everything
below is one machine, one run each, so read the numbers as orders of magnitude.

GPU backends actually available here: **CUDA0** (RTX 3090, `engine-cuda` build
staged in `src-tauri/resources/bin`), **Vulkan0** (same card, plus llvmpipe which
ggml does not expose), **CPU**. No Metal, ROCm, or Windows.

## Added binary size (`jan-llama-worker`, stripped)

The wrapper compiles to a 3.2 MB archive (1.3 MB of text) with no link-time
dependency beyond ggml. LTO drops what nothing calls, so the number depends on
whether the worker references the entry points (phase 2 will).

| Variant | Without wrapper | Wrapper linked, entry points unused | Wrapper linked and called | Delta (called) |
|---|---|---|---|---|
| cpu | 14,390,432 B | 14,417,592 B (+27 KB) | 15,698,008 B | +1.31 MB (+9.1%) |
| vulkan | not built | 14,420,440 B (3 KB above the cpu build with the wrapper) | not built | expected the same ~+1.3 MB: the TU only uses ggml-base symbols, so it does not depend on the backend |

Backend modules (`libggml-*.so`) are separate files and are unchanged.

## Build time

| Step | Time |
|---|---|
| cpu, cold-ish `cargo build --release --features engine --bin jan-llama-worker` (baseline, no wrapper, ggml/llama via ccache) | 3m23s |
| Wrapper TU alone, `g++ -O2` | 40 s (0.86 GB RSS) |
| Wrapper TU alone, `g++ -O0` | 18 s |
| Touch `jan_llama_diag.cpp`, rebuild worker (cc at opt 3 + fat LTO relink) | 88 s |
| Upstream's own `test-backend-ops` built unmodified, `g++ -O2`, for reference | 48 s |
| vulkan, `cargo test --release --features engine-vulkan --no-run` (all test bins, first Vulkan build in this tree) | 6m22s |

The wrapper is the single heaviest C++ translation unit in the shim (13.9k
lines of templates). It builds in parallel with nothing else in `cc`'s
sequence, so on a many-core machine it is the tail of the shim step. It is
rebuilt only when `jan_llama_diag.cpp` or the upstream file changes.

## Real case counts per op family (`diag_ops_json`, test mode, pinned b12110)

163 entries: 150 with tests, 13 without. Total **26,751 cases**. Upstream's
`--list-ops` reports 130 operations, `--show-coverage` 123 testable ops, 110
covered, 13 untested (ADD1, ADD_REL_POS, CUSTOM, DIAG_MASK_ZERO,
FLASH_ATTN_BACK, GET_REL_POS, IM2COL_BACK, MAP_CUSTOM1-3, POOL_2D_BACK,
WIN_PART, WIN_UNPART). Our listing has more entries than `--show-coverage`
because it keys on `op_desc`, so fusion cases get their own families
(`MUL_MAT_VEC_FUSION`, `TOPK_MOE`, `RMS_NORM_MUL_ROPE`, ...), which upstream's
coverage report drops. Counting is graph construction only: 50 ms.

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

## Runtime (test mode, one device, whole op list)

Each family is a separate `diag_run` (the leaf-process unit), 8 workers (`-j 8`).

| Run | Device | Cases run | Not supported | Failed | Wall time |
|---|---|---|---|---|---|
| Support probe, all families (no execution) | CPU | 19,828 | 3,239 | 0 | 0.3 s |
| Support probe, all families | CUDA0 | 16,228 | 6,839 | 0 | 0.4 s |
| Support probe, all families | Vulkan0 | 18,623 | 4,444 | 0 | 0.4 s |
| **Full test run**, 150 families | CPU (vs CPU reference) | 23,512 | 3,239 | 0 | **14m46s** |
| **Full test run**, 150 families | CUDA0 | 19,306 | 7,445 | 0 | **11m03s** |
| Quick: `ADD`, `-j 1` | CPU | 173 | 0 | 0 | 18.8 s |
| Quick: `ADD`, `-j 1` | CUDA0 | 167 | 6 | 0 | 18.9 s |
| Quick: `ADD`, `-j 1` | Vulkan0 | 116 | 57 | 0 | 18.9 s |
| `MUL_MAT`, `-j 1` | CPU | 2,631 | 460 | 0 | 181 s |
| `FLASH_ATTN_EXT`, `-j 1` | CPU | 5,439 | 0 | 0 | 420 s |

Slowest families at `-j 8` on CUDA0: MUL_MAT_ID 121 s, FLASH_ATTN_EXT 97 s,
MUL_MAT_ID_FUSION 81 s, MUL_MAT 80 s, GET_ROWS 54 s. On CPU: FLASH_ATTN_EXT 168 s,
MUL_MAT_ID 133 s, MUL_MAT 100 s, MUL_MAT_ID_FUSION 85 s.

Notes for the quick preset:

- `ADD` costs about 19 s on every device at `-j 1`. Likely (not profiled) the
  CPU reference run (`ggml_backend_cpu_set_use_ref`) plus tensor initialisation
  dominates, since the GPU and the CPU device take the same time. A GPU does not
  make a test run fast.
- The Support probe takes under half a second and answers "which ops fall back
  to CPU" for the whole op list, so it is the cheap first stage.
- Nothing failed on this machine, so the FAIL path was exercised by unit tests only.
- A Full run is minutes of 100% CPU on all cores; phase 3 should warn before it.

## Unknowns

- **Compiles as an included TU?** Yes with gcc 11, C++17. The only diagnostic seen from
  the TU is one `-Wunused-function` (`output_format_str`, used only by its own
  `main`), which `build.rs` silences for this TU only. Clang is not installed here, so it is
  untested. MSVC/clang-cl cannot be tested here; reasoning: llama.cpp's own
  CMake adds `/utf-8` (the file has non-ASCII literals, and a UTF-8 check mark in
  `--show-coverage`) and `/bigobj` (13.9k lines of case templates) to every
  target, so `build.rs` adds both under `is_like_msvc()`. The `#pragma optimize`
  lines in the file are MSVC-only and harmless elsewhere. Our `printf`/`fprintf` macros are
  defined after every standard header the upstream file includes, so a header
  that mentions the token is not rewritten (libstdc++'s `<cstdio>` does; MSVC's
  inline `printf` in `<stdio.h>` would be the same case, untested). Metal: the file already carries a
  Metal-only FA slice runner that uses `ggml_backend_reg_get_proc_address`, so it
  needs no Metal headers.
- **Needs LLAMA_BUILD_COMMON pieces?** No. It includes only the four ggml
  headers (`ggml.h`, `ggml-alloc.h`, `ggml-backend.h`, `ggml-cpp.h`) and the
  standard library. Our code adds `nlohmann/json.hpp` from `vendor/`. It links
  only the shared `ggml`/`ggml-base` that the worker already links. No libllama,
  no libcommon, no generated headers.
- **Is `tests/` pruned from the vendored tree?** No. `make engine-source` is a
  shallow clone of the pinned tag and prunes nothing; the flatpak manifest uses
  the full GitHub tag tarball. `tests/test-backend-ops.cpp` is present, and
  `build.rs` asserts it exists (with a message pointing at `make engine-source`).
  No change to the fetch script or the pin check was needed. `LLAMA_BUILD_TESTS`
  stays OFF. The prebuilt-bundle recipe (`engine-prebuilt.sh`) reads `ARCHIVES`; the
  wrapper is built by `cc` on every build like the shim and is deliberately not
  in `ARCHIVES`, so prebuilt bundles are unaffected.
- **Does upstream corrupt a JSON stdout?** Yes if left alone: the console printer
  and bare `printf`/`fprintf(stderr, ...)` calls in the case code (failed
  allocation, `ERR = ...`, NaN reports, `graph_compute failed`, the FA slice
  runner) write to the process streams. Our TU redefines `printf` and `fprintf`
  to capture text into a per-thread buffer around the `#include` (the only
  edit, and in our file, not upstream's) and attaches it to the failing result as
  `detail`. The JSON goes only through the callback. The remaining stderr noise is
  ggml's own log callback (`load_backend: ...`, `ggml_cuda_init`, `ggml_vulkan`),
  which is not upstream's file; the leaf worker must keep stdout reserved for
  events and read stderr separately.
- **Upstream behaviours to know:** its `show_test_coverage` loop aborts
  (`GGML_ASSERT(!use_weight_context())`) and segfaults on fusion cases if copied
  naively; `jan_llama_diag_ops_json` builds graphs the way `eval` does. A bad
  `-p` regex throws `std::regex_error` out of `test_backend`; the wrapper
  catches it and reports it as `done {ok:false,error}`.
