# KV cache memory: what can actually be tuned

Research note for Jan-AI-modded on a 16 GB Windows laptop (Intel UHD iGPU,
CPU/Vulkan llama.cpp). This is investigation only; nothing in this note has
been implemented.

Measured numbers are in [MEMORY-AUDIT.md](MEMORY-AUDIT.md#runtime-measurements-this-machine).
The short version: on this machine the KV cache is not the largest term for a
1.5B model at 32k — the context setting is, and so is the runtime used to
serve it. KV work is still the useful lever once a model is large or the
window is long.

## 1. Where the memory goes

Measured with the same binaries Jan ships, one chat request, MiB of working
set:

| Configuration | Total | Weights + runtime | KV at that context |
| --- | ---: | ---: | ---: |
| Qwen 1.5B, 32k, `f16` KV | 2,284 | ~1,350 | ~930 |
| Qwen 1.5B, 32k, `q4_0`/`q4_0` | 1,629 | ~1,350 | ~280 |
| Qwen 1.5B, 64k, `q4_0`/`q4_0` | 1,953 | ~1,350 | ~600 |
| Qwen 1.5B, 64k, `q8_0`/`q4_0` | 2,177 | ~1,350 | ~830 |
| Qwen 1.5B, 131k, `q4_0`/`q4_0` | 2,589 | ~1,350 | ~1,240 |
| Qwen 1.5B, 131k, `q8_0`/`q4_0` | 3,049 | ~1,350 | ~1,700 |
| Qwen 1.5B, 131k, `q8_0`/`q8_0` | 3,497 | ~1,350 | ~2,150 |
| LiteRT 0.6B, 32k | 8,489 | ~1,050 | ~7,400 (preallocated) |
| OpenVINO 1.5B, 32k | 1,972 | ~1,950 | ~0 (on demand, short prompt) |

The differences matter more than the absolute split:

- llama.cpp grows linearly with the configured window: **~9.7 KiB per token**
  for this 1.5B layout at `q4_0`/`q4_0`, ~13 KiB at `q8_0`/`q4_0`.
- LiteRT allocates per position regardless of how much text is there:
  **~250 MiB per 1,000 tokens** between 4k and 32k, and the bundle clamps any
  request above 32,768 to its magic number (measured 64k and 131k both land at
  the 32k footprint).
- OpenVINO allocates on demand; a short prompt costs nothing extra at 131k, and
  the model's own 32k window is the real limit.

## 2. Mainline llama.cpp levers (available in this build)

The shipped worker (`jan-llama-worker.exe`, llama.cpp b11146) already contains
all of the flags below, and Jan's preset generator already knows most of them.

### 2.1 Context size — the biggest lever

- Jan's `ctx_size` per model is the real budget. The generic fallback is 8192;
  models imported with a larger value keep it.
- `fit` is on by default upstream and in Jan's new defaults. It reduces *unset*
  arguments to fit device memory. A per-model `ctx-size` is respected, so fit
  cannot save a model that was given 131k explicitly.
- `fit-ctx` (minimum context fit may choose, default 4096) is the floor; do not
  rely on fit as a substitute for a sensible context value.
- On a 16 GB UMA machine the practical bands measured here are: 8–32k safe for
  a 1.5B model; 64k comfortable with `q8_0`/`q4_0`; 131k only for small models
  or when nothing else is open. A 4B model at 131k is still the OOM shape
  (40–58 KiB/token for `q4_0` KV).

### 2.2 KV cache types — the second lever

Jan exposes `cache_type_k` / `cache_type_v` (`-ctk`/`-ctv`), default
`q8_0`/`q4_0`. Measured savings at 32k on Qwen 1.5B: 655 MiB versus `f16`.

The ladder, in order of preference:

| K / V | Relative size | Quality | Notes |
| --- | --- | --- | --- |
| `f16` / `f16` | 1.00 | reference | fastest; use when it fits |
| `q8_0` / `q8_0` | ~0.53 | ~0 perplexity change in published tests | safest compressed option |
| `q8_0` / `q4_0` | ~0.40 | good in practice; K protected | Jan default; measured coherent |
| `q4_0` / `q4_0` | ~0.28 | full-attention models degrade | measured "You You" loops at 64k/131k |

Why not quantize K further:

- K feeds the dot product and softmax that decide *where* attention goes; V is
  averaged afterwards. Error in K changes the addressing, error in V is partly
  absorbed. This is the common finding in community tests and matches what we
  saw: `q4_0` K produced unusable output twice at 64k, while `q8_0` K at the
  same context answered coherently.
- Hybrid-attention models (some layers linear/SWA, e.g. Qwen3.5-class) tolerate
  `q4_0` much better because the non-attention layers damp the error. Qwen2.5
  1.5B is conventional full attention, which is the bad case.
- Quantized V requires flash attention. The worker defaults `flash_attn=auto`
  and the Jan preset emits it when set; keep it on.

Cost: quantization is a memory feature, not a speed feature. Published A100
tests put `q8_0` decode at 56% of `f16` at 64k depth and `q4_0` at 53%, while
prefill stays within 3%. On CPU the relative dequant cost can be worse. If the
cache fits at `f16`, `f16` is the faster choice.

### 2.3 Host prompt cache and checkpoints

This is the least obvious RAM consumer and the easiest cap to miss.

- `cache_ram` (`-cram`, default **8192 MiB**) is a host-RAM prompt cache. It
  keeps finished prompts as "extra slots" so a later request can hot-swap a
  matching prefix instead of re-prefilling. Two limits apply: bytes
  (`cache_ram`) and cached tokens (default = context size). It is a cap, not a
  preallocation, but on a 16 GB machine 8 GiB is a large ceiling. `0` disables
  it; `-1` means unlimited (do not use on 16 GB).
- `ctx_checkpoints` (default 32 per slot in this worker, Jan exposes it) stores
  context states in host RAM so a shifted context can be restored instead of
  reprocessed. `checkpoint_min_step` (default 8192 tokens) controls spacing.
  Upstream treats checkpoints and the prompt cache as host-RAM state; lower the
  count on a small machine.
- `swa_full` (default off) is correct for Gemma/hybrid models: the window-sized
  SWA cache is much smaller than a full-size one. Turning it on costs memory
  and only buys branch-anywhere restores. `swa_checkpoints` (when present) store
  only the SWA part and are relatively small.

Suggested values on this machine: `cache_ram = 1024–2048`,
`ctx_checkpoints = 4–8`, keep `swa_full` off. The trade is more reprocessing
when alternating between long chats; measure time-to-first-token after the
change rather than assuming it is free.

### 2.4 Slots, unified KV and parallelism

Our worker logs `n_slots = 4, kv_unified = true`: a single KV pool of
`ctx-size` tokens shared by all sequences, not 4 × ctx. That is the right shape
for one user. Jan exposes `kv_unified` (auto/on/off) and
`kv_unified_per_slot`, which caps one conversation's share of the pool.
Reducing `parallel` also reduces per-slot bookkeeping and the chance of idle
slots being cached; `1` is reasonable for a single-user desktop.

### 2.5 Context shift and cache reuse

- `context-shift` (Jan `ctx_shift`, default off) discards the oldest tokens
  once the window is full, so memory stays at the configured ctx instead of
  overflowing. It is a correctness trade (old turns are dropped), not a
  compression technique.
- `cache_reuse` (default 0) reuses matching prefix chunks via KV shifting.
  It saves prefill time, not resident memory.
- `slot-save-path` / Jan's thread cache writes KV to disk and restores it across
  sessions. It is disk, not RAM; the OS page cache can still create pressure,
  so keep `thread_cache_size` (default 8 GiB) bounded.

### 2.6 Offload, mmap and locking on a UMA iGPU

Measured: `no-kv-offload` changed 131k `q8_0`/`q4_0` from 3,049 to 3,024 MiB
working set — noise. There is no separate VRAM pool on this iGPU; the Vulkan
device and the CPU read the same physical RAM, so moving the KV buffer between
them does not create or free capacity.

- `mlock` forces pages resident and defeats reclaim; it is the opposite of what
  a 16 GB machine wants. Jan's `load_mode` default is `mmap` for a reason.
- `mmap`/`lazy-mode` can lower the *private commit* while leaving file-backed
  pages reclaimable, at the cost of disk reads if the model is evicted. That is
  usually the right trade for a model you are not actively using.
- Partial offload to the iGPU (`n_gpu_layers`) can improve speed but does not
  reduce total RAM on UMA; it may increase it by duplicating buffers.

### 2.7 Flash attention

`flash_attn=auto` is the right setting; it is required for quantized V and is
what makes `q8_0`/`q4_0` work. If a backend cannot run FA, the safe response
is to fall back to `f16` KV rather than force a quantized cache. On this CPU/
Vulkan build the mixed `q8_0`/`q4_0` pair ran and answered coherently; `q4_0`
did too, but with unusable output quality — the problem was quality, not a
missing kernel.

## 3. Beyond mainline

### 3.1 KVMem

[KVMem](https://github.com/kvmem/kvmem) (formerly `kvmem-llama.cpp`) is a fork
that virtualizes conversation KV across GPU memory, host RAM and NVMe. Finished
history lives in host RAM; each new question brings a bounded window of
relevant blocks back to the GPU. It also ships a custom NInfer backend and a
patched `llama-kvmem-server.exe`. The [paper](https://arxiv.org/abs/2609.04852)
reports a 1M-token agent workspace on a 24 GB RTX 5090 laptop at ~50 tok/s, and
the [llama.cpp discussion](https://github.com/ggml-org/llama.cpp/discussions/28894)
reports 256k on a 16 GB RTX 5060 Ti with a 32k active window (85.6% vs 86.6%
accuracy against full history on LongMemEval-S).

Why it is not a drop-in here:

- The published packages are Windows **NInfer/CUDA** builds for RTX 30/40/50;
  the llama.cpp backend needs a source build with CUDA. There is no
  CPU/Vulkan/Intel package, and Jan's `jan-llama-worker.exe` is a shim around
  stock llama.cpp with its own preset/handshake, not the KVMem server.
- Its design assumes a discrete VRAM pool plus a larger host-RAM pool. On this
  machine the "GPU" is the same 16 GB of RAM, so host tiering does not add
  capacity; the win would be bounding the active window and paging the rest to
  SSD, at the cost of retrieval misses and latency on a CPU-bound decoder.
- It keeps a 32k GPU working set for a 27B model; that model's weights alone do
  not fit our GPU budget, so KVMem does not make a 27B model runnable here. It
  could, in principle, let a small model keep a 131k logical conversation with
  a 16k active window — an experiment, not a shipped feature.

Verdict: worth a lab spike if a CPU/Vulkan build appears or if the tiering core
can be lifted into the worker; not a solution for Jan's default engine today.

### 3.2 TurboQuant

Google Research's [TurboQuant](https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/)
(paper 2504.19874) quantizes KV below 3 bits with near-zero accuracy loss and —
the important part — computes attention directly on quantized values, avoiding
the per-token dequantization that makes `q4_0` slower at depth. Community
forks report 4.9× compression for 3-bit (`TQ3`) and 3.8× for 4-bit (`TQ4`)
versus FP16. It is a [proposal/community fork](https://github.com/ggml-org/llama.cpp/discussions/20969),
not mainline, and the working implementations are CUDA-first.

Verdict: the most promising next step for extreme context, but nothing to ship
until it lands upstream with a CPU path. On this machine `q8_0`/`q4_0` already
gives most of the practical benefit at 1.5B scale.

### 3.3 Other techniques

- **Attention sinks / StreamingLLM** keeps the first few tokens plus a recent
  window, so memory is constant. It changes model behavior and is not in
  llama.cpp; it is a research technique.
- **H2O / SnapKV / PyramidKV** evict low-attention KV entries. They reduce
  memory but can break exact-prefix caching and long-range recall; no mainline
  llama.cpp implementation.
- **PagedAttention / vLLM-style paging** removes fragmentation and over-
  allocation for many concurrent requests. llama.cpp has a unified KV pool and
  checkpoints instead; for one desktop user there is little fragmentation to
  recover.
- **KV offload to host/SSD** (LMCache, KV streaming) moves cache out of VRAM.
  On UMA there is no separate VRAM to move out of; on this machine the only
  slower tier is SSD, and an SSD round trip per token is not viable.

## 4. Recommended profiles for this machine

| Profile | ctx | KV | `cache_ram` | checkpoints | Notes |
| --- | ---: | --- | ---: | ---: | --- |
| Daily / small model | 8,192–32,768 | `q8_0`/`q4_0` | 1,024–2,048 | 8 | ~1.6–2.2 GiB for 1.5B |
| Long chat | 65,536 | `q8_0`/`q4_0` | 1,024–2,048 | 4–8 | ~2.2 GiB for 1.5B |
| Maximum, small model only | 131,072 | `q8_0`/`q4_0` | 1,024 | 4 | ~3.0 GiB for 1.5B; no 4B |
| LiteRT | 4,096–8,192 | n/a | n/a | n/a | 32k costs 8.5 GiB |
| OpenVINO | 8,192–32,768 | n/a | n/a | n/a | ~2 GiB; 32k is the model limit |

Rules of thumb:

1. If `f16` KV fits, use it; otherwise `q8_0`/`q8_0`; otherwise the Jan default
   `q8_0`/`q4_0`.
2. Do not go to `q4_0` K on a full-attention model at long context without an
   actual quality check; it failed visibly here.
3. Cap `cache_ram`; 8 GiB is a desktop-sized default, not a 16 GB laptop one.
4. One loaded model at a time; the cross-engine unload fix is what makes this
   true when switching engines.
5. LiteRT above 8k is not a context win on this machine — it is a 2.5–8.5 GiB
   allocation for a 0.6B model.

## 5. What Jan could implement next

Ordered by payoff and risk:

1. **RAM-aware context cap / warning** (the open audit item). Use GGUF metadata
   (`n_layer`, `n_kv_heads`, `head_dim`) to estimate KV bytes/token and compare
   with installed RAM minus a reserve; block or warn above it. This is the
   direct fix for the 4B/131k OOM shape.
2. **Scale `cache_ram` and `ctx_checkpoints` defaults with installed RAM**
   (e.g. 1 GiB / 8 checkpoints on ≤16 GB, 2 GiB / 16 on 32 GB). Keep them
   user-editable.
3. **Lower the LiteRT `ctx_size` maximum** to 8,192 (or 16,384 with a warning).
   The bundle silently clamps above 32,768 and costs 8.5 GiB at that point.
4. **Add context presets** ("Balanced 16k", "Long 64k", "Max 131k") that set
   ctx + KV type together, so users do not pick 131k with `f16`.
5. **Expose per-engine RSS** in the model settings or a diagnostics panel, so a
   user can see the sidecar cost before they hit swap.
6. **Lab spike: KVMem/TurboQuant.** Only after upstream CPU/Vulkan support
   exists; any integration should be an optional backend, not a replacement for
   the stock worker.

## 6. Verification plan (when implementing any of the above)

- Load the same model at 4k, 32k, 64k and 131k; record Working Set and private
  bytes after one warm-up request. Memory should track the KV formula within
  ~5%.
- Check answer quality at 64k with a deterministic prompt (temperature 0) for
  each KV type; `q4_0` K should be rejected if it loops.
- Toggle `cache_ram` and run a two-turn long conversation; confirm the resident
  delta stays under the cap and measure time-to-first-token.
- On a 16 GB machine, keep at least 2 GiB free during the test; abort at 600 MiB
  free (the harness used here does this).
- Re-run after any llama.cpp bump: cache flags and defaults move between builds.

## Sources

- [llama-server manual (flags and defaults)](https://manpages.debian.org/unstable/llama.cpp-tools/llama-server.1.en.html)
- [llama.cpp PR #16391 — host-memory prompt caching (`--cache-ram`)](https://github.com/ggml-org/llama.cpp/pull/16391)
- [llama.cpp PR #15293 — SWA checkpoints and `--swa-full`](https://github.com/ggml-org/llama.cpp/pull/15293)
- [SOTAAZ — KV cache quantization measured, q8_0 vs q4_0 vs f16](https://sotaaz.com/post/llamacpp-kv-cache-quantization-guide-en)
- [OpenClaw DC — q8_0 vs q4_0 vs f16 (2026)](https://openclawdc.com/blog/kv-cache-quantization-q8-vs-q4-vram/)
- [llama.cpp discussion #20969 — TurboQuant](https://github.com/ggml-org/llama.cpp/discussions/20969)
- [Google Research — TurboQuant](https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/)
- [KVMem paper (arXiv 2609.04852)](https://arxiv.org/abs/2609.04852)
- [KVMem repository](https://github.com/kvmem/kvmem)
- [llama.cpp discussion #28894 — KVMem + llama.cpp](https://github.com/ggml-org/llama.cpp/discussions/28894)
