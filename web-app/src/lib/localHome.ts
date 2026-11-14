import { isPlatformTauri } from '@/lib/platform'

let pending: Promise<string | null> | undefined

/**
 * The user's home directory, or `null` where there is nothing to ask.
 *
 * Exists so a report can take the home directory out of a path by *knowing*
 * it rather than guessing at its shape. Guessing is what
 * [`stripLocalPaths`](./engineError) has to do without it, and a profile
 * folder containing spaces makes that ambiguous against ordinary prose in a
 * log line -- there is no rule that separates `/home/Jo Smith/lib` from
 * `/home/bob and models/x.gguf` by looking at the text alone.
 *
 * Cached: it cannot change while the app is running.
 */
export function localHomeDir(): Promise<string | null> {
  // The *promise* is cached, not a provisional answer: a second caller during
  // the lookup would otherwise be handed `null` and fall back to the weaker
  // heuristic, which is exactly the case this exists to avoid.
  pending ??= lookUp()
  return pending
}

async function lookUp(): Promise<string | null> {
  if (!isPlatformTauri()) return null
  try {
    const { homeDir } = await import('@tauri-apps/api/path')
    // Trailing separator dropped so it joins the same way on both families.
    return (await homeDir()).replace(/[/\\]+$/, '') || null
  } catch {
    // Web build or a missing plugin: the heuristic is all there is.
    return null
  }
}
