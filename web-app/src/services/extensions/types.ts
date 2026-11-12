/**
 * Extensions Service Types
 *
 * The install pipeline of runtime extensions: staging a bundle or an index
 * entry, consenting to its permissions, and managing what is installed and
 * where it can be installed from. The shapes are the ones the guest-js of
 * tauri-plugin-extensions returns; only the manifest and the permission
 * lists are narrowed, to what this host validated.
 */

import type {
  PermissionString,
  ValidatedManifest,
} from '@janhq/extension-api'
import type * as Plugin from '@janhq/tauri-plugin-extensions-api'
import type {
  Catalog,
  ExtensionSource,
  IndexSourceEntry as IndexSource,
  SourceList,
} from '@janhq/tauri-plugin-extensions-api'

export type {
  Catalog,
  CuratedIndex,
  IndexExtension,
  IndexVersion,
  IndexSourceEntry as IndexSource,
  ExtensionSource as InstallSource,
  RemovedPin,
  SourceList,
  SourcesNotice,
} from '@janhq/tauri-plugin-extensions-api'

/** What an update asks for beyond, and no longer needs from, the old grants. */
export interface PermissionDiff {
  added: PermissionString[]
  removed: PermissionString[]
}

/** The installed version a staged update would replace. */
export interface ExistingInstall {
  version: string
  granted: PermissionString[]
  /**
   * Where the installed version came from, so an update from another
   * source (or an unsigned one) can say so.
   */
  installedFrom: {
    source: ExtensionSource
    verified: boolean
  }
}

/**
 * A bundle extracted to staging and waiting for consent. Nothing runs and
 * nothing is registered until `confirmInstall`; `discardStage` drops it.
 * `verified` is true only for an entry of a source with a pinned key whose
 * index signature verified, so a file picked from disk or an entry of an
 * unsigned source never is; both need the user's explicit trust.
 */
export type StagedInstall = Omit<
  Plugin.StagedInstall,
  'manifest' | 'existing' | 'permissionDiff'
> & {
  /** The package's manifest, validated against this app's API version. */
  manifest: ValidatedManifest
  /** Present when this is an update of an installed extension. */
  existing?: ExistingInstall
  permissionDiff: PermissionDiff
}

/** One entry of `<jan_data>/extensions/extensions.json`. */
export type InstalledExtension = Omit<
  Plugin.InstalledExtension,
  'manifest' | 'granted' | 'permissions'
> & {
  /** The manifest of the active version (`version`). */
  manifest: ValidatedManifest
  /** What the user granted; a subset of `permissions`. */
  granted: PermissionString[]
  /** What the active version requests. */
  permissions: PermissionString[]
}

/** The registry; when `safeMode` is on, no installed extension is loaded. */
export type ListResult = Omit<Plugin.ListResult, 'extensions'> & {
  extensions: InstalledExtension[]
}

export interface ExtensionsService {
  /** False where there is no install pipeline (web, mobile). */
  isSupported(): boolean
  /** Copies, hashes and extracts a `.tgz` from disk. Never verified. */
  stageBundle(path: string): Promise<StagedInstall>
  /** Downloads `id@version` from a source and checks its pinned integrity. */
  stageFromIndex(
    sourceId: string,
    id: string,
    version: string
  ): Promise<StagedInstall>
  /** `granted` must hold every permission the manifest requests. */
  confirmInstall(
    stageId: string,
    granted: PermissionString[]
  ): Promise<InstalledExtension>
  discardStage(stageId: string): Promise<void>
  list(): Promise<ListResult>
  setEnabled(id: string, enabled: boolean): Promise<void>
  /** Revokes: `granted` may only drop permissions. */
  setGrants(id: string, granted: PermissionString[]): Promise<void>
  uninstall(id: string): Promise<void>
  /** Swaps the active and previous versions. */
  rollback(id: string): Promise<InstalledExtension>
  setSafeMode(on: boolean): Promise<void>
  /** The sources, removed pins, and what a store repair dropped. */
  listSources(): Promise<SourceList>
  addSource(
    url: string,
    name: string,
    publicKey?: string
  ): Promise<IndexSource>
  removeSource(id: string): Promise<void>
  /** The index of a source; a keyed source's signature must verify. */
  getCatalog(sourceId: string): Promise<Catalog>
  /**
   * Re-pins a source's key to the `nextPublicKey` its signed index offers.
   * Only after the user confirmed the rotation.
   */
  acceptNextKey(sourceId: string, nextPublicKey: string): Promise<IndexSource>
}
