import { validateManifest, type ValidatedManifest } from '@janhq/extension-api'
import { fs, joinPath } from '@janhq/core'
import { getExtensionHost, type HostedExtension } from './host'

/**
 * Why a folder could not be loaded. `code` picks the
 * `extensions:devLoad.<code>` message and `params` fills it.
 */
export type DevLoadErrorCode =
  | 'readFailed'
  | 'invalidJson'
  | 'invalidManifest'
  | 'alreadyLoaded'

export class DevLoadError extends Error {
  constructor(
    readonly code: DevLoadErrorCode,
    readonly params: Record<string, string> = {}
  ) {
    super(`${code}: ${JSON.stringify(params)}`)
    this.name = 'DevLoadError'
  }
}

/** A folder's manifest and bundle, read and validated but not started. */
export interface UnpackedExtension {
  dir: string
  manifest: ValidatedManifest
  bundle: string
}

async function readText(dir: string, file: string): Promise<string> {
  try {
    const content: unknown = await fs.readFileSync(await joinPath([dir, file]))
    if (typeof content !== 'string') throw new Error('not a text file')
    return content
  } catch (error) {
    throw new DevLoadError('readFailed', {
      file,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Reads `package.json` and its `jan.main` bundle from an extension folder.
 * `validateManifest` refuses a `main` that is absolute or has `..` in it,
 * so the bundle path cannot leave the folder.
 */
export async function readUnpacked(folder: string): Promise<UnpackedExtension> {
  const dir = folder.replace(/[\\/]+$/, '')
  let pkg: unknown
  try {
    pkg = JSON.parse(await readText(dir, 'package.json'))
  } catch (error) {
    if (error instanceof DevLoadError) throw error
    throw new DevLoadError('invalidJson', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  const result = validateManifest(pkg)
  if (!result.ok)
    throw new DevLoadError('invalidManifest', {
      errors: result.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
    })
  const main = result.manifest.main.replace(/^\.\//, '')
  return { dir, manifest: result.manifest, bundle: await readText(dir, main) }
}

/**
 * Starts a folder read by `readUnpacked` as a `dev` worker extension,
 * granted every permission its manifest requests: the developer already
 * confirmed them. Nothing is persisted, so it is gone after a restart. A
 * dev load that is not running is replaced, so a fixed folder can be retried.
 */
export async function loadUnpacked(
  unpacked: UnpackedExtension
): Promise<HostedExtension> {
  const host = getExtensionHost()
  const { manifest, bundle } = unpacked
  const existing = host.list().find((e) => e.id === manifest.id)
  if (existing) {
    const running =
      existing.state === 'active' || existing.state === 'activating'
    if (existing.source !== 'dev' || running)
      throw new DevLoadError('alreadyLoaded', { id: manifest.id })
    await host.unload(manifest.id)
  }
  return host.spawnWorkerExtension({
    manifest,
    bundle,
    grants: manifest.permissions,
    source: 'dev',
  })
}
