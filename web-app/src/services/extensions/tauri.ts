/**
 * Tauri Extensions Service - the install pipeline of the desktop app,
 * through the guest-js of tauri-plugin-extensions.
 */

import { validateManifest } from '@janhq/extension-api'
import * as plugin from '@janhq/tauri-plugin-extensions-api'
import {
  errorText,
  installedManifest,
  toPermissions,
} from '@/lib/extensions/installed-loader'
import type {
  Catalog,
  ExtensionsService,
  IndexSource,
  InstalledExtension,
  ListResult,
  SourceList,
  StagedInstall,
} from './types'

/**
 * Narrows a stage to what this host accepts. Rust validated the manifest
 * already; the TS rules are the host's, so a package they refuse is
 * discarded rather than offered for consent.
 */
async function toStaged(staged: plugin.StagedInstall): Promise<StagedInstall> {
  const result = validateManifest(staged.manifest)
  if (!result.ok) {
    await plugin.discardStage(staged.stageId).catch(() => undefined)
    throw new Error(
      result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')
    )
  }
  const { existing, permissionDiff, ...rest } = staged
  return {
    ...rest,
    manifest: result.manifest,
    ...(existing
      ? {
          existing: {
            version: existing.version,
            granted: toPermissions(existing.granted),
            installedFrom: {
              source: existing.source,
              verified: existing.verified,
            },
          },
        }
      : {}),
    permissionDiff: {
      added: toPermissions(permissionDiff.added),
      removed: toPermissions(permissionDiff.removed),
    },
  }
}

function toInstalled(
  entry: plugin.InstalledExtension
): InstalledExtension | undefined {
  const checked = installedManifest(entry)
  if (!checked.ok) {
    console.error(`Installed extension '${entry.id}' is invalid:`, checked.error)
    return undefined
  }
  return {
    ...entry,
    manifest: checked.manifest,
    granted: toPermissions(entry.granted),
    permissions: toPermissions(entry.permissions),
  }
}

function requireInstalled(entry: plugin.InstalledExtension): InstalledExtension {
  const installed = toInstalled(entry)
  if (!installed)
    throw new Error(`Installed extension '${entry.id}' has an invalid manifest`)
  return installed
}

/** Plugin rejections are `{ kind, message }`; the page shows `message`. */
async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw new Error(errorText(error))
  }
}

export class TauriExtensionsService implements ExtensionsService {
  isSupported(): boolean {
    return true
  }

  stageBundle(path: string): Promise<StagedInstall> {
    return call(async () => toStaged(await plugin.stageBundle(path)))
  }

  stageFromIndex(
    sourceId: string,
    id: string,
    version: string
  ): Promise<StagedInstall> {
    return call(async () =>
      toStaged(await plugin.stageFromIndex(sourceId, id, version))
    )
  }

  confirmInstall(
    stageId: string,
    granted: string[]
  ): Promise<InstalledExtension> {
    return call(async () =>
      requireInstalled(await plugin.confirmInstall(stageId, granted))
    )
  }

  discardStage(stageId: string): Promise<void> {
    return call(() => plugin.discardStage(stageId))
  }

  list(): Promise<ListResult> {
    return call(async () => {
      const listed = await plugin.list()
      return {
        ...listed,
        extensions: listed.extensions.flatMap((e) => toInstalled(e) ?? []),
      }
    })
  }

  setEnabled(id: string, enabled: boolean): Promise<void> {
    return call(() => plugin.setEnabled(id, enabled))
  }

  setGrants(id: string, granted: string[]): Promise<void> {
    return call(() => plugin.setGrants(id, granted))
  }

  uninstall(id: string): Promise<void> {
    return call(() => plugin.uninstall(id))
  }

  rollback(id: string): Promise<InstalledExtension> {
    return call(async () => requireInstalled(await plugin.rollback(id)))
  }

  setSafeMode(on: boolean): Promise<void> {
    return call(() => plugin.setSafeMode(on))
  }

  listSources(): Promise<SourceList> {
    return call(() => plugin.listSources())
  }

  addSource(url: string, name: string, publicKey?: string): Promise<IndexSource> {
    return call(() => plugin.addSource(url, name, publicKey))
  }

  removeSource(id: string): Promise<void> {
    return call(() => plugin.removeSource(id))
  }

  getCatalog(sourceId: string): Promise<Catalog> {
    return call(() => plugin.getCatalog(sourceId))
  }

  acceptNextKey(sourceId: string, nextPublicKey: string): Promise<IndexSource> {
    return call(() => plugin.acceptNextKey(sourceId, nextPublicKey))
  }
}
