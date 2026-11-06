import { fs, joinPath, logger } from '@janhq/core'

/** A directory under `models/` that holds a `model.yml`. */
export type ModelEntry = {
  /** The path below `models/`, e.g. `author/model` for a Hub download. */
  modelId: string
  configPath: string
}

/**
 * Every model under `modelsDir`, however deeply nested.
 *
 * Model IDs are paths: an import is `models/<id>/model.yml`, but a Hub quant is
 * saved as `models/<author>/<model>/model.yml`, so a one-level scan misses most
 * downloads. A directory with a `model.yml` is a model and is not descended
 * into. An unreadable entry (Windows AV quarantine, a junction, a locked file)
 * is logged and skipped so it cannot hide every other model.
 */
export async function findModelEntries(modelsDir: string): Promise<ModelEntry[]> {
  const entries: ModelEntry[] = []
  const stack: string[] = [modelsDir]
  while (stack.length > 0) {
    const currentDir = stack.pop() as string
    const configPath = await joinPath([currentDir, 'model.yml'])
    if (await fs.existsSync(configPath)) {
      // +1 drops the leading separator. NOTE: not Windows-`\\`-aware, the same
      // trade-off list() and the preset always made.
      entries.push({ modelId: currentDir.slice(modelsDir.length + 1), configPath })
      continue
    }

    let children: string[] = []
    try {
      children = await fs.readdirSync(currentDir)
    } catch (err) {
      logger.warn(`models scan: readdir failed for ${currentDir}: ${String(err)}`)
      continue
    }
    for (const child of children) {
      try {
        const stat = await fs.fileStat(child)
        if (stat?.isDirectory) stack.push(child)
      } catch (err) {
        logger.warn(`models scan: stat failed for ${child}: ${String(err)}`)
      }
    }
  }
  return entries
}
