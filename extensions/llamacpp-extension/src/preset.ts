/**
 * @file Generates the llama-server router preset INI from per-model `model.yml`
 * files under `<providerPath>/models/<modelId>/model.yml`.
 *
 * Phase 2 keeps the preset minimal — model path, mmproj, chat-template,
 * load-on-startup=false. A small `[*]` global section pulls a couple of
 * conservative defaults from `LlamacppConfig`. Per-model setting fidelity
 * is deferred to Phase 3.
 */

import { fs, joinPath } from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'
import type { LlamacppConfig, ModelConfig } from '@janhq/tauri-plugin-llamacpp-api'

// ModelConfig is intentionally widened — model.yml may carry extra fields like
// `chat_template` that aren't yet in the strict typing.
type ModelYaml = ModelConfig & {
  chat_template?: string
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
  spec_draft_n_max?: number
  spec_draft_n_min?: number
  spec_draft_p_min?: number
  cpu_moe?: boolean
  n_cpu_moe?: number
  no_kv_offload?: boolean
  override_tensor?: string
  mmproj_offload?: boolean
}

export const MTP_MIN_BUILD = 9193

const DEFAULT_EMBEDDING_UBATCH = 2048

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
  opts: { supportsMtp?: boolean } = {}
): Promise<{ path: string; embeddingCount: number }> {
  const supportsMtp = opts.supportsMtp === true
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
  // ctx-size default = 0 (loaded from model); any positive user value is intent.
  // Skip when auto-fit is enabled — fit owns context sizing and an explicit
  // ctx-size would override it.
  const fitEnabled = config.fit !== false
  if (
    !fitEnabled &&
    typeof config.ctx_size === 'number' &&
    config.ctx_size > 0
  ) {
    lines.push(`ctx-size = ${config.ctx_size}`)
  }
  // n-gpu-layers default = 0 / auto; emit any non-negative explicit value.
  if (typeof config.n_gpu_layers === 'number' && config.n_gpu_layers >= 0) {
    lines.push(`n-gpu-layers = ${config.n_gpu_layers}`)
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
  // parallel default = -1 (auto); positive user value is intent.
  if (typeof config.parallel === 'number' && config.parallel > 0) {
    lines.push(`parallel = ${config.parallel}`)
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
  // ubatch-size default = 512
  if (
    typeof config.ubatch_size === 'number' &&
    Number.isFinite(config.ubatch_size) &&
    config.ubatch_size > 0 &&
    config.ubatch_size !== 512
  ) {
    lines.push(`ubatch-size = ${Math.floor(config.ubatch_size)}`)
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
  // no-mmap / mlock default = false
  if (config.no_mmap === true) {
    lines.push('no-mmap = true')
  }
  if (config.mlock === true) {
    lines.push('mlock = true')
  }
  // rope-scaling default = 'none'
  if (
    typeof config.rope_scaling === 'string' &&
    config.rope_scaling.length > 0 &&
    config.rope_scaling !== 'none'
  ) {
    lines.push(`rope-scaling = ${escapeIniValue(config.rope_scaling)}`)
  }
  // rope-scale / rope-freq-scale default = 1.0 (identity / no scaling);
  // rope-freq-base default = 0 (loaded from model).
  if (
    typeof config.rope_scale === 'number' &&
    Number.isFinite(config.rope_scale) &&
    config.rope_scale > 0 &&
    config.rope_scale !== 1
  ) {
    lines.push(`rope-scale = ${config.rope_scale}`)
  }
  if (
    typeof config.rope_freq_base === 'number' &&
    Number.isFinite(config.rope_freq_base) &&
    config.rope_freq_base > 0
  ) {
    lines.push(`rope-freq-base = ${config.rope_freq_base}`)
  }
  if (
    typeof config.rope_freq_scale === 'number' &&
    Number.isFinite(config.rope_freq_scale) &&
    config.rope_freq_scale > 0 &&
    config.rope_freq_scale !== 1
  ) {
    lines.push(`rope-freq-scale = ${config.rope_freq_scale}`)
  }
  // context-shift default = enabled
  if (config.ctx_shift === false) {
    lines.push('context-shift = false')
  }
  // cache-ram default = 8192 MiB
  if (
    typeof config.cache_ram === 'number' &&
    Number.isFinite(config.cache_ram) &&
    config.cache_ram !== 8192
  ) {
    lines.push(`cache-ram = ${Math.floor(config.cache_ram)}`)
  }
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

    if (mc.chat_template && mc.chat_template.trim().length > 0) {
      lines.push(`chat-template = ${escapeIniValue(mc.chat_template)}`)
    }

    // Per-model overrides — same default-skipping rules as the [*] block.
    // ctx-size is skipped when auto-fit is on so fit can size the context.
    if (
      !fitEnabled &&
      typeof mc.ctx_size === 'number' &&
      mc.ctx_size > 0
    ) {
      lines.push(`ctx-size = ${mc.ctx_size}`)
    }
    if (typeof mc.n_gpu_layers === 'number' && mc.n_gpu_layers >= 0) {
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
      lines.push(`parallel = ${mc.parallel}`)
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

    if (
      mc.mtp === true &&
      typeof mc.mtp_layers === 'number' &&
      mc.mtp_layers > 0 &&
      supportsMtp
    ) {
      lines.push('spec-type = draft-mtp')
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

    if (mc.embedding === true) {
      embeddingCount++
      lines.push('embeddings = true')
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
