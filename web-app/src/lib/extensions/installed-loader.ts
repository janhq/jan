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

async function loadOne(
  host: ExtensionHost,
  registry: InstalledRegistry,
  entry: Plugin.InstalledExtension
): Promise<void> {
  const checked = installedManifest(entry)
  if (!checked.ok) {
    // Without a valid manifest the host has nothing to list it under.
    console.error(`Installed extension '${entry.id}' is invalid:`, checked.error)
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

/**
 * Starts the enabled installed extensions in workers, or only `only` when
 * given. Nothing loads in safe mode. Each one is independent: a failure is
 * recorded on that extension (`failed` with the reason) and the rest load.
 */
export async function loadInstalled(
  host: ExtensionHost,
  registry: InstalledRegistry,
  only?: string
): Promise<void> {
  let listed: Plugin.ListResult
  try {
    listed = await registry.list()
  } catch (error) {
    console.error('Could not read the installed extensions:', errorText(error))
    return
  }
  if (listed.safeMode) return
  for (const entry of listed.extensions) {
    if (!entry.enabled || (only !== undefined && entry.id !== only)) continue
    await loadOne(host, registry, entry)
  }
}
