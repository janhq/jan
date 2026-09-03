/**
 * @file Generates `router.preset.ini` from the per-model `model.yml` files under
 * `<providerPath>/models/<modelId>/model.yml`.
 *
 * The file has a `[*]` section of engine-wide defaults, then one `[<modelId>]`
 * section per model. Only values that differ from llama.cpp's own defaults are
 * written, so the preset stays intent-revealing and a setting left alone keeps
 * whatever upstream (or the GGUF) decided. `load-on-startup = false` is the one
 * unconditional line.
 *
 * An ini key is the CLI flag with its leading dashes removed, resolved by
 * `common/preset.cpp` `get_map_key_opt`. Defaults quoted below are from
 * `common/common.h` at the pinned build.
 */

import { fs, joinPath } from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'
import type { LlamacppConfig, ModelConfig } from '@janhq/tauri-plugin-llamacpp-api'

// ModelConfig is intentionally widened — model.yml may carry extra fields like
// `chat_template` that aren't yet in the strict typing.
type ModelYaml = ModelConfig & {
  chat_template?: string
  grammar?: string
  ctx_size?: number
  n_gpu_layers?: number
  flash_attn?: string
  cache_type_k?: string
  cache_type_v?: string
  parallel?: number
  cont_batching?: boolean
  pooling?: 'none' | 'mean' | 'cls' | 'last' | 'rank'
  ubatch_size?: number
  batch_size?: number
  mtp_layers?: number
  mtp?: boolean
  mtp_model_path?: string
  spec_type?: string
  temperature?: number
  top_k?: number
  top_p?: number
  min_p?: number
  repeat_last_n?: number
  repeat_penalty?: number
  presence_penalty?: number
  frequency_penalty?: number
  spec_draft_n_max?: number
  spec_draft_n_min?: number
  spec_draft_p_min?: number
  cpu_moe?: boolean
  n_cpu_moe?: number
  no_kv_offload?: boolean
  override_tensor?: string
  mmproj_offload?: boolean
}

// One extra llama-server slot beyond the user-visible "Parallel Sequences"
// count, reserved for background requests (e.g. thread auto-titling) that
// must never be able to evict the user's own chat KV cache from its slot.
// Hidden from the setting's UI value.
//
// Added unconditionally, and that is load-bearing. The emitted `parallel` is
// therefore always 3 or more, which is what lets the frontend pin background
// work and Cowork to fixed slot ids (web-app/src/constants/models.ts) instead
// of computing an index here that the two sides then have to keep in sync.
// Upstream wraps an out-of-range id_slot modulo the slot count rather than
// rejecting it, so any such desync is silent: the background request lands back
// on the chat slot and overwrites the cache it was meant to protect.
export const RESERVED_BACKGROUND_SLOTS = 2

/**
 * The ubatch every embedding model's preset section is pinned to.
 *
 * Exported because `embed()` has to budget its batches against the *embedder's*
 * ubatch, not the engine-wide setting: llama.cpp rejects a batch wider than
 * n_ubatch outright, with no retry path.
 */
export const DEFAULT_EMBEDDING_UBATCH = 2048

/**
 * Where each thread's saved KV cache lives.
 *
 * Under the provider directory rather than a temp dir: it is a cache the user
 * paid prefill time for and expects to survive a reboot, which is the whole
 * point. Shared verbatim with the Rust side, which llama.cpp joins file names
 * onto, so the two must not compute it differently -- this function is the one
 * definition.
 */
export function threadCacheDir(providerPath: string): string {
  return `${providerPath}/thread-cache`
}

// Fallback context size when the user hasn't set one, to avoid loading a
// model's full trained context (which can OOM on large-context models).
const DEFAULT_CTX_SIZE = 8192

/**
 * The `--spec-type` values llama.cpp accepts for a draft model
 * (common/speculative.cpp). A model.yml records one at import; anything else
 * -- an older install with no record, or a value we do not recognise -- falls
 * back to MTP, which is what every embedded-head model is.
 */
const SPEC_TYPES = new Set([
  'draft-mtp',
  'draft-eagle3',
  'draft-dflash',
  'draft-dspark',
])
const DEFAULT_SPEC_TYPE = 'draft-mtp'

/**
 * A built-in template name (`chatml`, `llama3`, ...) as opposed to a template
 * body. `--chat-template` takes either, but `--chat-template-file` reads its
 * value as a path, so the two have to be told apart. Any real jinja carries
 * `{`, whitespace or a newline, none of which match here.
 */
const BUILTIN_TEMPLATE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// Absolute paths only: a relative one would resolve against llama.cpp's cwd,
// which is not something the user can predict. Covers POSIX, drive-letter and
// UNC forms.
const ABSOLUTE_PATH_RE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/

/**
 * When a setting value is an absolute path to an existing file, the preset
 * passes it through to the corresponding `*-file` flag instead of treating it
 * as an inline body.
 */
async function existingFilePath(value: string): Promise<string | null> {
  if (!ABSOLUTE_PATH_RE.test(value)) return null
  try {
    return (await fs.existsSync(value)) ? value : null
  } catch {
    return null
  }
}

function escapeIniValue(v: string): string {
  // INI values for llama-server are read as strings; trim surrounding whitespace
  // and strip stray newlines that would break parsing.
  return String(v).replace(/[\r\n]+/g, ' ').trim()
}

/**
 * Walks `<providerPath>/models/*` recursively for `model.yml` files and emits
 * a router preset INI to `<providerPath>/router.preset.ini`. Returns the
 * absolute path of the written file.
 */
export async function generatePreset(
  providerPath: string,
  janDataFolderPath: string,
  config: LlamacppConfig,
  opts: { reservedBackgroundSlots?: number } = {}
): Promise<{ path: string; embeddingCount: number }> {
  // Overridable for tests only. Production callers take the default: gating it
  // on the auto-title setting made the reservation appear and disappear behind
  // a toggle that regenerates no preset, so the frontend's pin outlived the
  // slot it named.
  const reservedBackgroundSlots =
    typeof opts.reservedBackgroundSlots === 'number'
      ? opts.reservedBackgroundSlots
      : RESERVED_BACKGROUND_SLOTS
  const modelsDir = await joinPath([providerPath, 'models'])

  // Ensure the directory exists; an empty install is fine — we still emit a
  // valid (mostly empty) preset so the router can start.
  if (!(await fs.existsSync(modelsDir))) {
    await fs.mkdir(modelsDir)
  }

  // DFS for any directory containing model.yml — mirrors the logic in
  // index.ts:list() so nested model IDs (e.g. "huggingface/foo") work.
  const modelEntries: { modelId: string; configPath: string }[] = []
  const stack: string[] = [modelsDir]
  while (stack.length > 0) {
    const currentDir = stack.pop() as string
    const modelConfigPath = await joinPath([currentDir, 'model.yml'])
    if (await fs.existsSync(modelConfigPath)) {
      // +1 to drop leading separator. NOTE: matches index.ts behavior; not
      // Windows-`\\`-aware, same trade-off as the existing list() impl.
      const modelId = currentDir.slice(modelsDir.length + 1)
      if (modelId.length > 0) {
        modelEntries.push({ modelId, configPath: modelConfigPath })
      }
      continue
    }
    let children: string[] = []
    try {
      children = await fs.readdirSync(currentDir)
    } catch {
      continue
    }
    for (const child of children) {
      try {
        const stat = await fs.fileStat(child)
        if (stat?.isDirectory) stack.push(child)
      } catch {
        /* ignore unreadable entries */
      }
    }
  }

  modelEntries.sort((a, b) => a.modelId.localeCompare(b.modelId))

  const kvUnifiedIsAuto =
    config.kv_unified !== 'on' && config.kv_unified !== 'off'

  const lines: string[] = []

  // Emit only values that differ from llama.cpp's compiled defaults so the
  // preset stays minimal and intent-revealing. Defaults sourced from
  // tools/server/README.md.
  lines.push('[*]')
  // fit default = 'on'
  if (config.fit === false) {
    lines.push('fit = off')
  }
  // fit-target default = '1024' (MiB per device)
  if (
    typeof config.fit_target === 'string' &&
    config.fit_target.length > 0 &&
    config.fit_target !== '1024'
  ) {
    lines.push(`fit-target = ${escapeIniValue(config.fit_target)}`)
  }
  // fit-ctx default = 4096
  const fitCtxNum =
    typeof config.fit_ctx === 'number'
      ? config.fit_ctx
      : typeof config.fit_ctx === 'string' && config.fit_ctx.length > 0
        ? Number(config.fit_ctx)
        : NaN
  if (Number.isFinite(fitCtxNum) && fitCtxNum > 0 && fitCtxNum !== 4096) {
    lines.push(`fit-ctx = ${fitCtxNum}`)
  }
  // ctx-size: llama.cpp's own default loads the model's full trained context,
  // which can OOM on a large-context model, so a conservative cap stands in.
  // There is no engine-level context setting to read here -- per-model
  // `ctx_len` owns that -- so this is purely the guard.
  //
  // Skipped when auto-fit is on: emitting it would make n_ctx non-zero for
  // every model and stop fit from reducing context to make a model fit.
  const fitEnabled = config.fit !== false
  if (!fitEnabled) {
    lines.push(`ctx-size = ${DEFAULT_CTX_SIZE}`)
  }
  // flash-attn default = 'auto'; explicit on/off only.
  if (
    typeof config.flash_attn === 'string' &&
    (config.flash_attn === 'on' || config.flash_attn === 'off')
  ) {
    lines.push(`flash-attn = ${config.flash_attn}`)
  }
  // cache-type-k/v default = 'f16'
  if (
    typeof config.cache_type_k === 'string' &&
    config.cache_type_k.length > 0 &&
    config.cache_type_k !== 'f16'
  ) {
    lines.push(`cache-type-k = ${escapeIniValue(config.cache_type_k)}`)
  }
  if (
    typeof config.cache_type_v === 'string' &&
    config.cache_type_v.length > 0 &&
    config.cache_type_v !== 'f16'
  ) {
    lines.push(`cache-type-v = ${escapeIniValue(config.cache_type_v)}`)
  }
  // parallel default = -1 (auto); positive user value is intent. The reserved
  // slot is added on top and never exposed in the setting's own value.
  if (typeof config.parallel === 'number' && config.parallel > 0) {
    lines.push(`parallel = ${config.parallel + reservedBackgroundSlots}`)
    // llama.cpp only turns on unified KV as part of resolving parallel = -1;
    // passing parallel explicitly leaves it off, which splits ctx-size into
    // ctx-size/parallel per slot. Restore the auto behaviour so the configured
    // context is what each slot actually gets.
    if (kvUnifiedIsAuto) lines.push('kv-unified = true')
  }
  // cont-batching default = true; emit only the explicit-off case.
  if (config.cont_batching === false) {
    lines.push('cont-batching = false')
  }
  // threads default = -1 (logical cores)
  if (
    typeof config.threads === 'number' &&
    Number.isFinite(config.threads) &&
    config.threads > 0
  ) {
    lines.push(`threads = ${Math.floor(config.threads)}`)
  }
  // threads-batch default = same as threads; emit only if positive and distinct.
  if (
    typeof config.threads_batch === 'number' &&
    Number.isFinite(config.threads_batch) &&
    config.threads_batch > 0 &&
    config.threads_batch !== config.threads
  ) {
    lines.push(`threads-batch = ${Math.floor(config.threads_batch)}`)
  }
  // n-predict default = -1 (infinity)
  if (
    typeof config.n_predict === 'number' &&
    Number.isFinite(config.n_predict) &&
    config.n_predict !== -1
  ) {
    lines.push(`n-predict = ${Math.floor(config.n_predict)}`)
  }
  // batch-size default = 2048 (common.h: n_batch)
  if (
    typeof config.batch_size === 'number' &&
    Number.isFinite(config.batch_size) &&
    config.batch_size > 0 &&
    config.batch_size !== 2048
  ) {
    lines.push(`batch-size = ${Math.floor(config.batch_size)}`)
  }
  // ubatch-size default = 512
  if (
    typeof config.ubatch_size === 'number' &&
    Number.isFinite(config.ubatch_size) &&
    config.ubatch_size > 0 &&
    config.ubatch_size !== 512
  ) {
    lines.push(`ubatch-size = ${Math.floor(config.ubatch_size)}`)
  }
  // n-cpu-moe default = 0 (no MoE weights pinned to the host)
  if (
    typeof config.n_cpu_moe === 'number' &&
    Number.isFinite(config.n_cpu_moe) &&
    config.n_cpu_moe > 0
  ) {
    lines.push(`n-cpu-moe = ${Math.floor(config.n_cpu_moe)}`)
  }
  // no-kv-offload default = false (the cache is offloaded). Spelled negatively
  // to match llama.cpp's own flag and the existing no_mmap setting.
  // common_preset's parse_bool_arg recognises `no-kv-offload` as the negated
  // half of the kv-offload pair (arg.cpp:2403-2410) and inverts it, so `true`
  // here does disable offloading.
  if (config.no_kv_offload === true) {
    lines.push('no-kv-offload = true')
  }
  // tensor-split default = empty (even split across devices).
  if (
    typeof config.tensor_split === 'string' &&
    config.tensor_split.trim().length > 0
  ) {
    lines.push(`tensor-split = ${escapeIniValue(config.tensor_split.trim())}`)
  }
  // no-op-offload default = false (host tensor ops are offloaded).
  if (config.no_op_offload === true) {
    lines.push('no-op-offload = true')
  }
  // ctx-checkpoints default = 32, checkpoint-min-step default = 8192.
  if (
    typeof config.ctx_checkpoints === 'number' &&
    Number.isFinite(config.ctx_checkpoints) &&
    config.ctx_checkpoints >= 0 &&
    config.ctx_checkpoints !== 32
  ) {
    lines.push(`ctx-checkpoints = ${Math.floor(config.ctx_checkpoints)}`)
  }
  if (
    typeof config.checkpoint_min_step === 'number' &&
    Number.isFinite(config.checkpoint_min_step) &&
    config.checkpoint_min_step >= 0 &&
    config.checkpoint_min_step !== 8192
  ) {
    lines.push(`checkpoint-min-step = ${Math.floor(config.checkpoint_min_step)}`)
  }
  // device default = empty (auto-pick)
  if (typeof config.device === 'string' && config.device.trim().length > 0) {
    lines.push(`device = ${escapeIniValue(config.device)}`)
  }
  // split-mode default = 'layer'
  if (
    typeof config.split_mode === 'string' &&
    config.split_mode.length > 0 &&
    config.split_mode !== 'layer'
  ) {
    lines.push(`split-mode = ${escapeIniValue(config.split_mode)}`)
  }
  // main-gpu default = 0
  if (
    typeof config.main_gpu === 'number' &&
    Number.isFinite(config.main_gpu) &&
    config.main_gpu > 0
  ) {
    lines.push(`main-gpu = ${Math.floor(config.main_gpu)}`)
  }
  // `--mlock` and `--no-mmap` are both deprecated aliases that write the single
  // params.load_mode field (arg.cpp:2658-2702), so emitting both left load_mode
  // at NONE and silently dropped mlock -- and mmap+mlock was unreachable.
  // Deriving the one key it actually wants fixes both.
  const wantsMlock = config.mlock === true
  const wantsNoMmap = config.no_mmap === true
  if (wantsMlock || wantsNoMmap) {
    const loadMode = wantsMlock
      ? wantsNoMmap
        ? 'mlock'
        : 'mmap+mlock'
      : 'none'
    lines.push(`load-mode = ${loadMode}`)
  }
  // rope-scaling default is UNSPECIFIED (let the model decide), not 'none'.
  // Treating 'none' as the default made "None" -- an explicit request to
  // disable scaling -- impossible to express.
  if (
    typeof config.rope_scaling === 'string' &&
    config.rope_scaling.length > 0 &&
    config.rope_scaling !== 'auto'
  ) {
    lines.push(`rope-scaling = ${escapeIniValue(config.rope_scaling)}`)
  }
  // rope-freq-base default = 0 (loaded from model).
  if (
    typeof config.rope_freq_base === 'number' &&
    Number.isFinite(config.rope_freq_base) &&
    config.rope_freq_base > 0
  ) {
    lines.push(`rope-freq-base = ${config.rope_freq_base}`)
  }
  // rope-freq-scale default = 0 (loaded from model). 1.0 is not the default: it
  // is an explicit "force no scaling", so it must still be emitted. `rope_scale`
  // is gone -- it was a second spelling of this same upstream field (as 1/N).
  if (
    typeof config.rope_freq_scale === 'number' &&
    Number.isFinite(config.rope_freq_scale) &&
    config.rope_freq_scale > 0
  ) {
    lines.push(`rope-freq-scale = ${config.rope_freq_scale}`)
  }
  // context-shift default = disabled
  if (config.ctx_shift === true) {
    lines.push('context-shift = true')
  }
  // cache-ram default = 8192 MiB
  if (
    typeof config.cache_ram === 'number' &&
    Number.isFinite(config.cache_ram) &&
    config.cache_ram !== 8192
  ) {
    lines.push(`cache-ram = ${Math.floor(config.cache_ram)}`)
  }
  // slot-save-path has no default: naming it is what enables llama.cpp's slot
  // save/restore routes at all. Emitted even with the feature off, so the worker
  // knows which directory to keep clear and can still erase a deleted thread's
  // state; the *budget* is what decides whether anything is written. The C++ arg
  // handler throws if the directory is missing -- the worker creates it first.
  lines.push(`slot-save-path = ${escapeIniValue(threadCacheDir(providerPath))}`)
  // cache-reuse default = 0 (disabled)
  if (
    typeof config.cache_reuse === 'number' &&
    Number.isFinite(config.cache_reuse) &&
    config.cache_reuse > 0
  ) {
    lines.push(`cache-reuse = ${Math.floor(config.cache_reuse)}`)
  }
  if (config.swa_full === true) {
    lines.push('swa-full = true')
  }
  // auto is handled next to each `parallel` emission above; with no explicit
  // parallel the flag is omitted so llama.cpp's own auto resolution applies.
  if (config.kv_unified === 'on') {
    lines.push('kv-unified = true')
  } else if (config.kv_unified === 'off') {
    lines.push('kv-unified = false')
  }
  // keep default = 0
  if (
    typeof config.keep === 'number' &&
    Number.isFinite(config.keep) &&
    config.keep !== 0
  ) {
    lines.push(`keep = ${Math.floor(config.keep)}`)
  }
  lines.push('')

  // ---------- per-model sections ----------
  let embeddingCount = 0
  for (const { modelId, configPath } of modelEntries) {
    let mc: ModelYaml
    try {
      mc = await invoke<ModelYaml>('read_yaml', { path: configPath })
    } catch {
      // Skip unreadable model entries rather than aborting the whole preset.
      continue
    }

    if (!mc?.model_path) continue

    const modelAbs = await joinPath([janDataFolderPath, mc.model_path])

    lines.push(`[${modelId}]`)
    lines.push(`model = ${escapeIniValue(modelAbs)}`)

    if (mc.mmproj_path) {
      const mmprojAbs = await joinPath([janDataFolderPath, mc.mmproj_path])
      lines.push(`mmproj = ${escapeIniValue(mmprojAbs)}`)
    }

    // A template body cannot survive the ini: values have no line
    // continuation, and `#`/`;` anywhere in one starts a comment. So an
    // absolute path to an existing file passes through as-is, a built-in name
    // goes inline, and anything else is written beside model.yml and passed by
    // path, which llama.cpp reads verbatim.
    const chatTemplate =
      typeof mc.chat_template === 'string' ? mc.chat_template.trim() : ''
    if (chatTemplate.length > 0) {
      const templateFile = await existingFilePath(chatTemplate)
      if (templateFile) {
        lines.push(`chat-template-file = ${escapeIniValue(templateFile)}`)
      } else if (BUILTIN_TEMPLATE_NAME_RE.test(chatTemplate)) {
        lines.push(`chat-template = ${chatTemplate}`)
      } else {
        const templatePath = await joinPath([
          modelsDir,
          modelId,
          'chat_template.jinja',
        ])
        await fs.writeFileSync(templatePath, chatTemplate)
        lines.push(`chat-template-file = ${escapeIniValue(templatePath)}`)
      }
    }

    // GBNF uses `#` for comments and is usually multi-line, so an inline body
    // can never go through the ini; it always reaches llama.cpp as a file.
    const grammar = typeof mc.grammar === 'string' ? mc.grammar.trim() : ''
    if (grammar.length > 0) {
      const grammarFile = await existingFilePath(grammar)
      if (grammarFile) {
        lines.push(`grammar-file = ${escapeIniValue(grammarFile)}`)
      } else {
        const grammarPath = await joinPath([modelsDir, modelId, 'grammar.gbnf'])
        await fs.writeFileSync(grammarPath, grammar)
        lines.push(`grammar-file = ${escapeIniValue(grammarPath)}`)
      }
    }

    // Per-model overrides -- same default-skipping rules as the [*] block.
    // An explicit 0 means "native" (load the model's own trained context).
    //
    // Emitted even with auto-fit on, unlike n-gpu-layers below: upstream's fit
    // explicitly leaves a user-set context alone (common/fit.cpp: "context size
    // set by user -> no change") and only bails on an explicit n_gpu_layers. The
    // old gate is why "Increase Context Size" did nothing while Fit was on.
    let ctxEmitted = false
    if (
      typeof mc.ctx_size === 'number' &&
      Number.isFinite(mc.ctx_size) &&
      mc.ctx_size >= 0
    ) {
      lines.push(`ctx-size = ${mc.ctx_size}`)
      ctxEmitted = true
    }
    // Skipped when auto-fit is on: an explicit n-gpu-layers makes fit abort its
    // layer-offload computation. -1 is auto and -2 or below means all layers,
    // so the floor is -2 rather than 0.
    if (
      !fitEnabled &&
      typeof mc.n_gpu_layers === 'number' &&
      mc.n_gpu_layers >= -2
    ) {
      lines.push(`n-gpu-layers = ${mc.n_gpu_layers}`)
    }
    if (
      typeof mc.flash_attn === 'string' &&
      (mc.flash_attn === 'on' || mc.flash_attn === 'off')
    ) {
      lines.push(`flash-attn = ${mc.flash_attn}`)
    }
    if (
      typeof mc.cache_type_k === 'string' &&
      mc.cache_type_k.length > 0 &&
      mc.cache_type_k !== 'f16'
    ) {
      lines.push(`cache-type-k = ${escapeIniValue(mc.cache_type_k)}`)
    }
    if (
      typeof mc.cache_type_v === 'string' &&
      mc.cache_type_v.length > 0 &&
      mc.cache_type_v !== 'f16'
    ) {
      lines.push(`cache-type-v = ${escapeIniValue(mc.cache_type_v)}`)
    }
    if (typeof mc.parallel === 'number' && mc.parallel > 0) {
      lines.push(`parallel = ${mc.parallel + reservedBackgroundSlots}`)
      if (kvUnifiedIsAuto) lines.push('kv-unified = true')
    }
    if (mc.cont_batching === false) {
      lines.push('cont-batching = false')
    }
    if (
      typeof mc.batch_size === 'number' &&
      mc.batch_size > 0 &&
      mc.batch_size !== 2048
    ) {
      lines.push(`batch-size = ${Math.floor(mc.batch_size)}`)
    }
    if (
      typeof mc.ubatch_size === 'number' &&
      mc.ubatch_size > 0 &&
      mc.ubatch_size !== 512
    ) {
      lines.push(`ubatch-size = ${Math.floor(mc.ubatch_size)}`)
    }
    if (mc.cpu_moe === true) {
      lines.push('cpu-moe = true')
    }
    if (typeof mc.n_cpu_moe === 'number' && mc.n_cpu_moe > 0) {
      lines.push(`n-cpu-moe = ${Math.floor(mc.n_cpu_moe)}`)
    }
    if (mc.no_kv_offload === true) {
      // INI key is the negated form; parse_bool_arg flips it server-side.
      // Writing `no-kv-offload = true` => kv-offload disabled.
      lines.push('no-kv-offload = true')
    }
    if (typeof mc.override_tensor === 'string' && mc.override_tensor.trim().length > 0) {
      lines.push(`override-tensor = ${escapeIniValue(mc.override_tensor)}`)
    }
    // mmproj-offload defaults to on; only emit when explicitly disabled.
    if (mc.mmproj_offload === false) {
      lines.push('mmproj-offload = false')
    }

    // MTP either lives in the main gguf (mtp_layers > 0) or ships as a separate
    // draft gguf (mtp_model_path), which is passed to the engine as the draft.
    const hasMtpModel =
      typeof mc.mtp_model_path === 'string' && mc.mtp_model_path.length > 0
    const hasMtpLayers =
      typeof mc.mtp_layers === 'number' && mc.mtp_layers > 0
    if (mc.mtp === true && (hasMtpLayers || hasMtpModel)) {
      const specType =
        typeof mc.spec_type === 'string' && SPEC_TYPES.has(mc.spec_type)
          ? mc.spec_type
          : DEFAULT_SPEC_TYPE
      lines.push(`spec-type = ${specType}`)
      if (hasMtpModel) {
        const mtpAbs = await joinPath([janDataFolderPath, mc.mtp_model_path!])
        lines.push(`spec-draft-model = ${escapeIniValue(mtpAbs)}`)
      }
      if (
        typeof mc.spec_draft_n_max === 'number' &&
        mc.spec_draft_n_max > 0
      ) {
        lines.push(`spec-draft-n-max = ${Math.floor(mc.spec_draft_n_max)}`)
      }
      if (
        typeof mc.spec_draft_n_min === 'number' &&
        mc.spec_draft_n_min >= 0
      ) {
        lines.push(`spec-draft-n-min = ${Math.floor(mc.spec_draft_n_min)}`)
      }
      if (
        typeof mc.spec_draft_p_min === 'number' &&
        mc.spec_draft_p_min >= 0 &&
        mc.spec_draft_p_min <= 1
      ) {
        lines.push(`spec-draft-p-min = ${mc.spec_draft_p_min}`)
      }
    }

    // Per-model sampling defaults. llama-server applies these as server-side
    // defaults for every request to the model (chat and external API clients);
    // a per-request JSON field still overrides them. INI keys are the CLI
    // long-form names minus dashes.
    //
    // Skipping a value equal to llama.cpp's default is not just tidiness here:
    // passing any of the first six sets a `user_sampling_config` bit that
    // suppresses the GGUF's own `general.sampling.*` recommendations, so writing
    // an identical-looking default silently overrode what the model asked for.
    // `null` means "no default, always emit" -- the two penalties set no bit.
    const samplingIniKeys: Array<[keyof ModelYaml, string, number | null]> = [
      ['temperature', 'temperature', 0.8],
      ['top_k', 'top-k', 40],
      ['top_p', 'top-p', 0.95],
      ['min_p', 'min-p', 0.05],
      ['repeat_last_n', 'repeat-last-n', 64],
      ['repeat_penalty', 'repeat-penalty', 1.0],
      ['presence_penalty', 'presence-penalty', null],
      ['frequency_penalty', 'frequency-penalty', null],
    ]
    for (const [yamlKey, iniKey, upstreamDefault] of samplingIniKeys) {
      const v = mc[yamlKey]
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      if (upstreamDefault !== null && v === upstreamDefault) continue
      // Upstream throws on a negative window rather than clamping, which aborts
      // the load; a legacy -1 from the old "-1 = full context" UI must not reach
      // the preset.
      if (iniKey === 'repeat-last-n' && v < 0) continue
      lines.push(`${iniKey} = ${v}`)
    }

    if (mc.embedding === true) {
      embeddingCount++
      lines.push('embeddings = true')
      // Embedders have a small trained context (e.g. MiniLM = 512). Without an
      // explicit override they inherit the global [*] ctx-size (8192), which
      // exceeds n_ctx_train and fails to load. Pin to native (0 = load from
      // model) unless model.yml already set a positive per-model ctx-size.
      if (!ctxEmitted) {
        lines.push('ctx-size = 0')
      }
      const pooling =
        typeof mc.pooling === 'string' && mc.pooling.length > 0
          ? mc.pooling
          : 'mean'
      lines.push(`pooling = ${escapeIniValue(pooling)}`)
      const ubatch =
        typeof mc.ubatch_size === 'number' && mc.ubatch_size > 0
          ? mc.ubatch_size
          : DEFAULT_EMBEDDING_UBATCH
      const batch =
        typeof mc.batch_size === 'number' && mc.batch_size >= ubatch
          ? mc.batch_size
          : ubatch
      lines.push(`ubatch-size = ${ubatch}`)
      lines.push(`batch-size = ${batch}`)
    }

    lines.push('load-on-startup = false')
    lines.push('')
  }

  const outPath = await joinPath([providerPath, 'router.preset.ini'])
  const tmpPath = await joinPath([providerPath, 'router.preset.ini.tmp'])
  const body = lines.join('\n')

  // Atomic write: tmp + rename. fs.mv overwrites on Tauri's side.
  await fs.writeFileSync(tmpPath, body)
  try {
    // Best-effort cleanup of any prior file before rename — fs.mv may not
    // overwrite on all platforms.
    if (await fs.existsSync(outPath)) {
      try {
        await fs.rm(outPath)
      } catch {
        /* ignore */
      }
    }
    await fs.mv(tmpPath, outPath)
  } catch {
    // Fallback: if rename fails, write directly to the target.
    await fs.writeFileSync(outPath, body)
    try {
      await fs.rm(tmpPath)
    } catch {
      /* ignore */
    }
  }

  return { path: outPath, embeddingCount }
}
