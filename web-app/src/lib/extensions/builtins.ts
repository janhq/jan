import type { ExtensionModule, ValidatedManifest } from '@janhq/extension-api'
import * as assistant from '../../../../extensions/assistant-extension/package.json'
import * as download from '../../../../extensions/download-extension/package.json'

/**
 * A built-in that runs in the host process through `activate(ctx)`. The
 * manifest comes from the package's `jan` field and is validated at build
 * time by the bundled-extensions test.
 *
 * Its calls take the same dispatcher path as a worker's, so the same
 * argument checks apply: contribution ids follow the manifest grammar
 * (`isContributionId`), messages and status texts have the same length
 * caps. The worker limits do not apply (`BUILTIN_LIMITS`): no notification
 * rate, no cap on listeners per event or requests at once, no log budget.
 */
export interface BuiltinExtension {
  manifest: ValidatedManifest
  /** Lazy, so extension code stays out of the boot bundle graph. */
  load(): Promise<ExtensionModule>
  /** Ids of built-ins that must be active first. */
  dependsOn?: string[]
  /** Runs on mobile (no native plugin dependencies). Desktop-only otherwise. */
  mobile?: boolean
}

// Read field by field off the namespace import (never the whole object) so
// the bundler keeps only these exports of each package.json.
const manifestOf = (pkg: {
  name: string
  version: string
  jan: Omit<ValidatedManifest, 'name' | 'version'>
}): ValidatedManifest => ({ ...pkg.jan, name: pkg.name, version: pkg.version })

/**
 * The built-ins the host activates, in no particular order (dependsOn
 * decides). Legacy `BaseExtension` built-ins live in
 * services/core/bundled-extensions.ts until they migrate.
 */
export const HOST_BUILTINS: BuiltinExtension[] = [
  {
    manifest: manifestOf({
      name: assistant.name,
      version: assistant.version,
      jan: assistant.jan,
    }),
    load: () => import('@janhq/assistant-extension'),
  },
  {
    manifest: manifestOf({
      name: download.name,
      version: download.version,
      jan: download.jan,
    }),
    load: () => import('@janhq/download-extension'),
  },
]

export function getHostBuiltins(
  opts: { mobile?: boolean } = {}
): BuiltinExtension[] {
  return HOST_BUILTINS.filter((b) => (opts.mobile ? b.mobile : true))
}
