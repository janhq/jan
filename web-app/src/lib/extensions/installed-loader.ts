import {
  isPermissionString,
  validateManifest,
  type PermissionString,
  type ValidatedManifest,
} from '@janhq/extension-api'
import type * as Plugin from '@janhq/tauri-plugin-extensions-api'
import type { ExtensionHost } from './host'

/** What the loader reads: the registry and the hash-checked entry files. */
export type InstalledRegistry = Pick<typeof Plugin, 'list' | 'readEntry'>

/** A plugin rejection (`{ kind, message }`), an Error or anything else. */
export const errorText = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)

/**
 * The manifest of an installed version, as this host reads it. Rust checked
 * it at install time; the TS rules run again because they are the ones the
 * host enforces, and the files must still be the version the registry
 * names.
 */
export function installedManifest(
  entry: Pick<Plugin.InstalledExtension, 'id' | 'version' | 'manifest'>
): { ok: true; manifest: ValidatedManifest } | { ok: false; error: string } {
  const result = validateManifest(entry.manifest)
  if (!result.ok)
    return {
      ok: false,
      error: result.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
    }
  const { manifest } = result
  if (manifest.id !== entry.id || manifest.version !== entry.version)
    return {
      ok: false,
      error: `the files are ${manifest.id}@${manifest.version}, the registry names ${entry.id}@${entry.version}`,
    }
  return { ok: true, manifest }
}

/** Grants as the host types them; anything malformed is dropped. */
export const toPermissions = (granted: readonly string[]): PermissionString[] =>
  granted.filter(isPermissionString)

/**
 * Stands in for a manifest the host refused, so the failure still has an
 * entry, with the registry's id and version, to show under.
 */
const placeholderManifest = (
  entry: Pick<Plugin.InstalledExtension, 'id' | 'version'>
): ValidatedManifest => ({
  name: entry.id,
  version: entry.version,
  id: entry.id,
  displayName: entry.id,
  publisher: '',
  apiVersion: '',
  main: '',
  permissions: [],
})

async function loadOne(
  host: ExtensionHost,
  registry: InstalledRegistry,
  entry: Plugin.InstalledExtension
): Promise<void> {
  const checked = installedManifest(entry)
  if (!checked.ok) {
    await host.markFailed(placeholderManifest(entry), new Error(checked.error))
    return
  }
  const { manifest } = checked
  try {
    const { code } = await registry.readEntry(entry.id)
    // The host refuses an incompatible apiVersion before any worker starts.
    await host.spawnWorkerExtension({
      manifest,
      bundle: code,
      grants: toPermissions(entry.granted),
      source: 'installed',
    })
  } catch (error) {
    await host.markFailed(manifest, new Error(errorText(error)))
  }
}

/** The enabled installed extensions; none in safe mode or when unreadable. */
export async function enabledInstalled(
  registry: InstalledRegistry
): Promise<Plugin.InstalledExtension[]> {
  let listed: Plugin.ListResult
  try {
    listed = await registry.list()
  } catch (error) {
    console.error('Could not read the installed extensions:', errorText(error))
    return []
  }
  return listed.safeMode ? [] : listed.extensions.filter((e) => e.enabled)
}

/**
 * Starts installed extension `id` in a worker as the registry has it now,
 * unless it is disabled, uninstalled or in safe mode. A failure is recorded
 * on the extension (`failed` with the reason).
 */
export async function startInstalled(
  host: ExtensionHost,
  registry: InstalledRegistry,
  id: string
): Promise<void> {
  const entry = (await enabledInstalled(registry)).find((e) => e.id === id)
  if (entry) await loadOne(host, registry, entry)
}
