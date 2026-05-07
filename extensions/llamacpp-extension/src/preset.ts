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
  config: LlamacppConfig
): Promise<string> {
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

  // ---------- [*] global defaults ----------
  // Conservative: only emit `ctx-size` for now. Phase 3 will broaden.
  lines.push('[*]')
  if (typeof config.ctx_size === 'number' && config.ctx_size > 0) {
    lines.push(`ctx-size = ${config.ctx_size}`)
  }
  lines.push('')

  // ---------- per-model sections ----------
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
        await fs.unlinkSync(outPath)
      } catch {
        /* ignore */
      }
    }
    await fs.mv(tmpPath, outPath)
  } catch {
    // Fallback: if rename fails, write directly to the target.
    await fs.writeFileSync(outPath, body)
    try {
      await fs.unlinkSync(tmpPath)
    } catch {
      /* ignore */
    }
  }

  return outPath
}
