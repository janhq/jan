import { invoke, Channel } from '@tauri-apps/api/core'

/** Where an installed version came from (`extensions.json` `source`). */
export type ExtensionSource =
  | { kind: 'bundle'; fileName: string; sha512: string }
  | {
      kind: 'index'
      sourceId: string
      sourceName: string
      url: string
      tarball: string
      integrity: string
    }

/** What an update changes in the permissions the user is asked about. */
export interface PermissionDiff {
  /** Requested and not granted now: needs consent. */
  added: string[]
  /** Requested by the installed version and no longer by the new one. */
  removed: string[]
}

/** A package extracted to staging and awaiting `confirmInstall`. */
export interface StagedInstall {
  stageId: string
  /** The package.json of the package. */
  manifest: Record<string, unknown>
  /** SRI of the tarball. */
  sha512: string
  /** Signature-checked. Always false until index signatures exist. */
  verified: boolean
  /** The tarball matched an SRI pinned by an index source. */
  integrityChecked: boolean
  source: ExtensionSource
  /** The installed version this would update. */
  existing: { version: string; granted: string[] } | null
  permissionDiff: PermissionDiff
}

/** One installed extension. */
export interface InstalledExtension {
  id: string
  version: string
  previous: string | null
  enabled: boolean
  granted: string[]
  /** What the active version requests. */
  permissions: string[]
  source: ExtensionSource
  verified: boolean
  integrityChecked: boolean
  installedAt: string
  /** The active version's package.json, or null if unreadable. */
  manifest: Record<string, unknown> | null
}

export interface ListResult {
  safeMode: boolean
  /** Forced by JAN_EXTENSIONS_SAFE_MODE=1; the UI cannot turn it off. */
  safeModeForced: boolean
  /** Set when an unreadable extensions.json was moved aside at startup. */
  recoveredFrom: string | null
  extensions: InstalledExtension[]
}

/** The entry bundle of an enabled extension, checked against its hash. */
export interface EntrySource {
  code: string
  sha512: string
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

export interface HttpRequest {
  url: string
  method?: HttpMethod
  headers?: Record<string, string>
  body?: string
}

/**
 * A whole response. Redirects are not followed: a 3xx comes back with its
 * `location` header for the caller to check against the grants.
 */
export interface HttpResponse {
  status: number
  /** Lowercase names; cookie headers removed. */
  headers: Record<string, string>
  body: string
}

/** Events of `httpFetchStream`: `head`, any `chunk`s, then `end` or `error`. */
export type HttpStreamEvent =
  | { event: 'head'; status: number; headers: Record<string, string> }
  | { event: 'chunk'; data: string }
  | { event: 'end' }
  | { event: 'error'; kind: ExtensionsErrorKind; message: string }

/** `kind` of a rejected command (`{ kind, message }`). */
export type ExtensionsErrorKind =
  | 'bundle'
  | 'integrity'
  | 'manifest'
  | 'io'
  | 'notFound'
  | 'denied'
  | 'invalid'
  | 'tampered'
  | 'network'
  | 'tooLarge'
  | 'cancelled'

/** The value a command rejects with. */
export interface ExtensionsError {
  kind: ExtensionsErrorKind
  message: string
}

/** Extracts and validates a local `.tgz` into staging (unverified). */
export async function stageBundle(path: string): Promise<StagedInstall> {
  return await invoke('plugin:extensions|stage_bundle', { path })
}

/** Installs a stage; `granted` must cover every requested permission. */
export async function confirmInstall(
  stageId: string,
  granted: string[]
): Promise<InstalledExtension> {
  return await invoke('plugin:extensions|confirm_install', { stageId, granted })
}

export async function discardStage(stageId: string): Promise<void> {
  await invoke('plugin:extensions|discard_stage', { stageId })
}

export async function list(): Promise<ListResult> {
  return await invoke('plugin:extensions|list')
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  await invoke('plugin:extensions|set_enabled', { id, enabled })
}

/** Replaces the grants of `id`; may only remove. */
export async function setGrants(id: string, granted: string[]): Promise<void> {
  await invoke('plugin:extensions|set_grants', { id, granted })
}

export async function uninstall(id: string): Promise<void> {
  await invoke('plugin:extensions|uninstall', { id })
}

/** Swaps the active and previous versions. */
export async function rollback(id: string): Promise<InstalledExtension> {
  return await invoke('plugin:extensions|rollback', { id })
}

/** The entry bundle, only when enabled, not in safe mode and unmodified. */
export async function readEntry(id: string): Promise<EntrySource> {
  return await invoke('plugin:extensions|read_entry', { id })
}

export async function setSafeMode(on: boolean): Promise<void> {
  await invoke('plugin:extensions|set_safe_mode', { on })
}

/**
 * Fetches for extension `id`, re-checking its network grant. The body is
 * capped at 1 MiB. Pass `requestId` to be able to `httpCancel` it.
 */
export async function httpFetch(
  id: string,
  req: HttpRequest,
  requestId?: string
): Promise<HttpResponse> {
  return await invoke('plugin:extensions|http_fetch', { id, req, requestId })
}

/**
 * Streams a response for extension `id` (provider inference). Resolves
 * with the status once the stream is done; errors before the head reject,
 * errors after it arrive as an `error` event.
 */
export async function httpFetchStream(
  id: string,
  requestId: string,
  req: HttpRequest,
  onEvent: (event: HttpStreamEvent) => void
): Promise<number> {
  const channel = new Channel<HttpStreamEvent>()
  channel.onmessage = onEvent
  return await invoke('plugin:extensions|http_fetch_stream', {
    id,
    requestId,
    req,
    onEvent: channel,
  })
}

/** Cancels a running `httpFetch` or `httpFetchStream`. */
export async function httpCancel(id: string, requestId: string): Promise<void> {
  await invoke('plugin:extensions|http_cancel', { id, requestId })
}
