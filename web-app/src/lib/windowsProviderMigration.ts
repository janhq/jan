/**
 * Windows-only post-upgrade housekeeping. Runs in `main.tsx` *before*
 * React mounts so that `DataProvider` and other early consumers never
 * read stale values. On macOS / Linux every entry point in this module
 * short-circuits to a no-op.
 *
 * Two responsibilities, each with its own one-shot localStorage flag so
 * they can evolve independently:
 *
 *   1. Rewrite legacy `{ provider: 'llamacpp' }` references in
 *      non-zustand localStorage keys (currently
 *      `localStorageKey.lastUsedModel`). Per ADR 2026-05-22 "Windows
 *      ships only `llamacpp-upstream`", the `llamacpp` ModelProvider
 *      is no longer registered in the Windows build, so any persisted
 *      reference must be remapped. Zustand-managed state has its own
 *      versioned `migrate` hook in `useModelProvider`.
 *
 *   2. Schedule a single post-upgrade "find optimal backend" recheck
 *      for every Windows user that already finished onboarding. This
 *      brings both legacy turboquant users (who were on the janhq
 *      fork's CUDA build) and existing `llamacpp-upstream` users on
 *      the bundled CPU build onto the appropriate ggml-org variant
 *      for their hardware.
 */

import { localStorageKey } from '@/constants/localStorage'

const MIGRATION_FLAG_KEY = 'atomic_windows_llamacpp_to_upstream_v1'
const LEGACY_PROVIDER = 'llamacpp'
const UPSTREAM_PROVIDER = 'llamacpp-upstream'

/**
 * One-shot signal consumed by `useBackendUpdater.ts` on first paint after
 * the user upgrades to this Atomic Chat build. The hook auto-triggers
 * `recheckOptimalBackend()` once, then deletes this key. macOS / Linux
 * never write it.
 *
 * Why a separate key: this module runs before React mounts (in
 * `main.tsx`), so we can't trigger a hook callback from here directly.
 * The flag bridges the gap.
 */
export const WINDOWS_RECHECK_PENDING_KEY =
  'atomic_windows_llamacpp_recheck_pending_v1'

/**
 * Idempotency guard for the post-upgrade auto-recheck.
 *
 * Decoupled from `MIGRATION_FLAG_KEY` on purpose: users that already
 * ran an earlier build of this consolidation (e.g. a dev build between
 * iterations) have `MIGRATION_FLAG_KEY === 'done'` and would otherwise
 * miss the auto-recheck that was added later. Tracking the recheck
 * trigger under its own key means we can adjust either mechanism
 * without invalidating the other.
 *
 * The key is bumped to `_v2`, `_v3`, … whenever we want to re-fire the
 * auto-recheck for everyone (e.g. shipping a new bundled backend version).
 */
const WINDOWS_AUTO_RECHECK_FIRED_KEY =
  'atomic_windows_llamacpp_auto_recheck_fired_v1'

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
 * Schedules the one-shot post-upgrade optimal-backend recheck for
 * every Windows user that already finished onboarding. Two audiences
 * feed this:
 *
 *   1. Legacy turboquant users — the previous build pinned them to
 *      `b8892/win-cuda-*-common_cpus-x64` (janhq fork). We must
 *      replace that with the matching ggml-org variant from the new
 *      upstream tree (`b9284/win-cuda-{12.4|13.1}-x64`).
 *
 *   2. Existing `llamacpp-upstream` users on the bundled CPU build —
 *      they upgraded between Atomic Chat versions and may now have
 *      hardware whose optimal upstream variant differs from what they
 *      originally picked.
 *
 * Gated by `setup-completed === 'true'` so brand-new installs don't
 * race with `SetupBackendStep`, which runs `recheckOptimalBackend()`
 * itself as part of the regular onboarding flow.
 *
 * Idempotent via `WINDOWS_AUTO_RECHECK_FIRED_KEY`: the trigger fires at
 * most once per device per `_v*` revision of that key, regardless of
 * how many times `runWindowsLlamacppProviderMigration` is called.
 */
function scheduleWindowsPostUpgradeRecheck(): void {
  if (localStorage.getItem(WINDOWS_AUTO_RECHECK_FIRED_KEY) === 'done') return

  const setupCompleted =
    localStorage.getItem(localStorageKey.setupCompleted) === 'true'
  if (setupCompleted) {
    // `useBackendUpdater` reads this on mount, calls
    // `recheckOptimalBackend()` once, and removes the pending key
    // itself.
    localStorage.setItem(WINDOWS_RECHECK_PENDING_KEY, '1')
    console.info(
      '[migration:windows-llamacpp-to-upstream] scheduling one-shot optimal-backend recheck for upgraded user'
    )
  }

  // Mark the trigger as fired regardless of whether `setup-completed`
  // was true. A user who never completes onboarding doesn't need a
  // post-upgrade recheck — `SetupBackendStep` covers them.
  localStorage.setItem(WINDOWS_AUTO_RECHECK_FIRED_KEY, 'done')
}

/**
 * Runs the migration once. Safe to call multiple times; the second
 * invocation short-circuits via the flag. Errors are caught and logged —
 * a migration failure must NEVER block app startup.
 */
export function runWindowsLlamacppProviderMigration(): void {
  if (!IS_WINDOWS) return
  try {
    if (localStorage.getItem(MIGRATION_FLAG_KEY) !== 'done') {
      for (const key of KEYS_WITH_PROVIDER_FIELD) {
        const rewritten = rewriteProviderField(localStorage.getItem(key))
        if (rewritten !== null) {
          localStorage.setItem(key, rewritten)
          console.info(
            `[migration:windows-llamacpp-to-upstream] rewrote ${key}: provider 'llamacpp' -> 'llamacpp-upstream'`
          )
        }
      }
      localStorage.setItem(MIGRATION_FLAG_KEY, 'done')
    }

    // Decoupled from MIGRATION_FLAG_KEY on purpose so that users who
    // ran an earlier iteration of this consolidation (with no auto-
    // recheck scheduling) still receive it now. See the
    // `WINDOWS_AUTO_RECHECK_FIRED_KEY` docstring above.
    try {
      scheduleWindowsPostUpgradeRecheck()
    } catch {
      // localStorage access can fail in obscure WebView2 states —
      // silently skip; the next launch will retry.
    }
  } catch (err) {
    console.warn(
      '[migration:windows-llamacpp-to-upstream] migration failed (non-fatal):',
      err
    )
  }
}
