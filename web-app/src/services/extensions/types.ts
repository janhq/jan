/**
 * Extensions Service Types
 *
 * The install pipeline of runtime extensions: staging a bundle or an index
 * entry, consenting to its permissions, and managing what is installed and
 * where it can be installed from. Mirrors the commands of
 * tauri-plugin-extensions (janhq/jan-internal#470, #473) in camelCase.
 */

import type {
  PermissionString,
  ValidatedManifest,
} from '@janhq/extension-api'

/** What an update asks for beyond, and no longer needs from, the old grants. */
export interface PermissionDiff {
  added: PermissionString[]
  removed: PermissionString[]
}

/** The installed version a staged update would replace. */
export interface ExistingInstall {
  version: string
  granted: PermissionString[]
}

/**
 * A bundle extracted to staging and waiting for consent. Nothing runs and
 * nothing is registered until `confirmInstall`; `discardStage` drops it.
 */
export interface StagedInstall {
  stageId: string
  /** The package's manifest, validated against this app's API version. */
  manifest: ValidatedManifest
  /** `sha512-<base64>` of the tarball. */
  sha512: string
  /**
   * True only when the tarball matched the integrity pinned by an index.
   * A file picked from disk is never verified.
   */
  verified: boolean
  /** Present when this is an update of an installed extension. */
  existing?: ExistingInstall
  permissionDiff: PermissionDiff
}

/** Where an installed version came from. */
export type InstallSource =
  | { kind: 'bundle'; fileName: string; sha512: string }
  | {
      kind: 'index'
      sourceId: string
      url: string
      tarball: string
      integrity: string
    }

/** One registry entry of `<jan_data>/extensions/extensions.json`. */
export interface InstalledExtension {
  id: string
  /** The manifest of the active version. */
  manifest: ValidatedManifest
  enabled: boolean
  /** The active version. */
  active: string
  /** The version `rollback` would restore, when one is kept. */
  previous?: string
  source: InstallSource
  verified: boolean
  /** What the user granted; a subset of `manifest.permissions`. */
  granted: PermissionString[]
  entrySha512: string
  /** RFC 3339. */
  installedAt: string
}

export interface ListResult {
  /** When on, no installed extension is loaded. */
  safeMode: boolean
  extensions: InstalledExtension[]
}

/** A user-added index to browse and install from (https only). */
export interface IndexSource {
  id: string
  name: string
  url: string
  /** base64 ed25519 key, pinned when the source is added. */
  publicKey?: string
  /** RFC 3339. */
  addedAt: string
}

export interface IndexVersion {
  version: string
  tarball: string
  /** `sha512-<base64>`. */
  integrity: string
  apiVersion: string
  engines?: { jan: string }
  permissions: PermissionString[]
}

export interface IndexExtension {
  id: string
  displayName: string
  publisher: string
  description?: string
  homepage?: string
  versions: IndexVersion[]
}

/** An index document, schema 1. */
export interface CuratedIndex {
  schema: 1
  generatedAt: string
  extensions: IndexExtension[]
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
  listSources(): Promise<IndexSource[]>
  addSource(
    url: string,
    name: string,
    publicKey?: string
  ): Promise<IndexSource>
  removeSource(id: string): Promise<void>
  getCatalog(sourceId: string): Promise<CuratedIndex>
}
