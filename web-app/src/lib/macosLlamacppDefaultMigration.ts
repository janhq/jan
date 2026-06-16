/**
 * macOS-only post-upgrade housekeeping. Runs in `main.tsx` *before* React
 * mounts so that `DataProvider` (auto-start) and the model bar never read a
 * stale `lastUsedModel.provider`. On Windows / Linux every entry point in
 * this module short-circuits to a no-op.
 *
 * Background (ATO-136): ADR 2026-06-09 made `llamacpp-upstream` the default
 * local engine on macOS (ATO-116), but the matching zustand redirect in
 * `useModelProvider` was IS_WINDOWS-gated, and the non-zustand
 * `localStorageKey.lastUsedModel` blob was never rewritten on macOS at all.
 * So macOS users with a pre-ATO-116 profile kept auto-starting freshly
 * downloaded GGUFs on the turboquant fork (`llamacpp`), which crashes on
 * newer architectures (gemma4uv / lfm2moe).
 *
 * This rewrites the legacy `{ provider: 'llamacpp' }` reference in
 * `lastUsedModel` to `'llamacpp-upstream'`. The on-disk GGUF tree is shared
 * between both providers (`MODELS_PROVIDER_ROOT = 'llamacpp'` in the upstream
 * extension), so the same model id resolves under the upstream provider with
 * no model-level data migration. The turboquant `llamacpp` provider stays
 * registered on macOS as an explicit manual choice; we only move the
 * *default* off it. Zustand-managed state (`selectedProvider`) has its own
 * versioned `migrate` hook (v14) in `useModelProvider`.
 */

import { localStorageKey } from '@/constants/localStorage'

const MIGRATION_FLAG_KEY = 'atomic_macos_llamacpp_default_to_upstream_v1'
const LEGACY_PROVIDER = 'llamacpp'
const UPSTREAM_PROVIDER = 'llamacpp-upstream'

/**
 * Keys that store a JSON blob of the shape `{ provider: string; model: string }`.
 * Any other shape is left untouched — defensive against future format drift.
 */
const KEYS_WITH_PROVIDER_FIELD: readonly string[] = [
  localStorageKey.lastUsedModel,
]

interface ProviderModelRecord {
  provider?: string
  model?: string
  [key: string]: unknown
}

function rewriteProviderField(rawValue: string | null): string | null {
  if (!rawValue) return null
  try {
    const parsed: unknown = JSON.parse(rawValue)
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (parsed as ProviderModelRecord).provider === LEGACY_PROVIDER
    ) {
      const next: ProviderModelRecord = {
        ...(parsed as ProviderModelRecord),
        provider: UPSTREAM_PROVIDER,
      }
      return JSON.stringify(next)
    }
  } catch {
    // Not JSON — leave as-is. We never silently overwrite a value we
    // cannot safely parse.
  }
  return null
}

/**
 * Runs the migration once. Safe to call multiple times; the second
 * invocation short-circuits via the flag. Errors are caught and logged —
 * a migration failure must NEVER block app startup.
 */
export function runMacosLlamacppDefaultMigration(): void {
  if (!IS_MACOS) return
  try {
    if (localStorage.getItem(MIGRATION_FLAG_KEY) === 'done') return
    for (const key of KEYS_WITH_PROVIDER_FIELD) {
      const rewritten = rewriteProviderField(localStorage.getItem(key))
      if (rewritten !== null) {
        localStorage.setItem(key, rewritten)
        console.info(
          `[migration:macos-llamacpp-default-to-upstream] rewrote ${key}: provider 'llamacpp' -> 'llamacpp-upstream'`
        )
      }
    }
    localStorage.setItem(MIGRATION_FLAG_KEY, 'done')
  } catch (err) {
    console.warn(
      '[migration:macos-llamacpp-default-to-upstream] migration failed (non-fatal):',
      err
    )
  }
}
