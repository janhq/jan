import { isPlatformTauri } from '@/lib/platform/utils'
import { getServiceHub } from '@/hooks/useServiceHub'
import { localStorageKey } from '@/constants/localStorage'
import { HUGGINGFACE_TOKEN_SECRET_KEY } from '@/hooks/useGeneralSetting'

/**
 * One-time migration of settings from webview localStorage to the backend
 * settings store (+ OS keyring for secrets). Runs once, before store
 * hydration, guarded by a flag stored in the BACKEND (not localStorage) so a
 * downgrade -> re-upgrade never re-imports the stale localStorage fossil over
 * newer backend data. Per the migration-snapshot policy, localStorage is NOT
 * cleared: a downgraded (pre-feature) build can still read it.
 */
const MIGRATION_FLAG_KEY = '__settings_migrated_to_backend__'

// Every store key persisted through backendStorage. Plain copy unless listed in
// the secret-handling transforms below.
const MIGRATED_KEYS: string[] = [
  localStorageKey.theme,
  localStorageKey.settingInterface,
  localStorageKey.settingGeneral,
  localStorageKey.LeftPanel,
  localStorageKey.modelProvider,
  localStorageKey.productAnalyticPrompt,
  localStorageKey.productAnalytic,
  localStorageKey.settingHardware,
  localStorageKey.settingLocalApiServer,
  localStorageKey.toolApproval,
  localStorageKey.toolAvailability,
  localStorageKey.modelSources,
  localStorageKey.pausedDownloads,
  localStorageKey.settingProxyConfig,
  localStorageKey.settingVulkan,
  localStorageKey.favoriteModels,
  localStorageKey.latestJanModel,
  localStorageKey.janModelPromptDismissed,
  localStorageKey.defaultEmbeddingModel,
  localStorageKey.agentMode,
]

type Invoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>

// zustand persist wraps state as { state, version }; unwrap defensively.
function getStateSlice(parsed: unknown): Record<string, unknown> | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined
  const obj = parsed as Record<string, unknown>
  const inner = (obj.state ?? obj) as Record<string, unknown>
  return typeof inner === 'object' ? inner : undefined
}

// Move each provider's key chain into the keyring, then strip it from the blob.
async function transformModelProviderBlob(
  raw: string,
  invoke: Invoke
): Promise<string> {
  const parsed = JSON.parse(raw)
  const state = getStateSlice(parsed)
  const providers = Array.isArray(state?.providers)
    ? (state!.providers as Array<Record<string, unknown>>)
    : []

  for (const p of providers) {
    const primary = typeof p.api_key === 'string' ? p.api_key : ''
    const fallbacks = Array.isArray(p.api_key_fallbacks)
      ? (p.api_key_fallbacks as unknown[]).filter(
          (k): k is string => typeof k === 'string'
        )
      : []
    const chain = [primary, ...fallbacks]
      .map((k) => k.trim())
      .filter((k) => k.length > 0)

    if (p.provider !== 'llamacpp' && chain.length > 0) {
      const customHeaders = Array.isArray(p.custom_header)
        ? (p.custom_header as Array<{ header: string; value: string }>).map(
            (h) => ({ header: h.header, value: h.value })
          )
        : []
      const models = Array.isArray(p.models)
        ? (p.models as Array<{ id: string }>).map((m) => m.id)
        : []
      await invoke('register_provider_config', {
        request: {
          provider: p.provider,
          api_key: chain[0],
          api_keys: chain.slice(1),
          base_url: p.base_url,
          custom_headers: customHeaders,
          models,
        },
      })
    }

    delete p.api_key
    delete p.api_key_fallbacks
    if (Array.isArray(p.settings)) {
      for (const s of p.settings as Array<Record<string, unknown>>) {
        if (
          (s.key === 'api-key' || s.key === 'api-key-fallbacks') &&
          s.controller_props &&
          typeof s.controller_props === 'object'
        ) {
          const props = s.controller_props as Record<string, unknown>
          props.value = ''
        }
      }
    }
  }

  return JSON.stringify(parsed)
}

// Move the HF token into the keyring, then strip it from the blob.
async function transformGeneralBlob(
  raw: string,
  invoke: Invoke
): Promise<string> {
  const parsed = JSON.parse(raw)
  const state = getStateSlice(parsed)
  const token = state && typeof state.huggingfaceToken === 'string'
    ? (state.huggingfaceToken as string)
    : ''
  if (token.trim().length > 0) {
    await invoke('set_secret', {
      key: HUGGINGFACE_TOKEN_SECRET_KEY,
      value: token,
    })
  }
  if (state) delete state.huggingfaceToken
  return JSON.stringify(parsed)
}

export async function migrateLocalStorageToBackend(): Promise<void> {
  // On web there is no backend; localStorage IS the store, nothing to migrate.
  if (!isPlatformTauri() || typeof localStorage === 'undefined') return

  const invoke = getServiceHub().core().invoke.bind(
    getServiceHub().core()
  ) as Invoke

  try {
    const alreadyMigrated = await invoke<string | null>('settings_get', {
      key: MIGRATION_FLAG_KEY,
    })
    if (alreadyMigrated === 'true') return

    for (const key of MIGRATED_KEYS) {
      const local = localStorage.getItem(key)
      if (local == null) continue
      // Never clobber existing backend data (e.g. a downgrade/re-upgrade round).
      const existing = await invoke<string | null>('settings_get', { key })
      if (existing != null) continue

      let value = local
      if (key === localStorageKey.modelProvider) {
        value = await transformModelProviderBlob(local, invoke)
      } else if (key === localStorageKey.settingGeneral) {
        value = await transformGeneralBlob(local, invoke)
      }
      await invoke('settings_set', { key, value })
    }

    await invoke('settings_set', { key: MIGRATION_FLAG_KEY, value: 'true' })
  } catch (error) {
    // Leave the flag unset so migration retries on the next launch.
    console.error('Settings localStorage->backend migration failed:', error)
  }
}
