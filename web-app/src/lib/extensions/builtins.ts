import type { ExtensionModule, ValidatedManifest } from '@janhq/extension-api'

/**
 * A built-in that runs in the host process through `activate(ctx)`. The
 * manifest comes from the package's `jan` field and is validated at build
 * time by the bundled-extensions test.
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

/**
 * The built-ins the host activates, in no particular order (dependsOn
 * decides). Empty until the first migration (P1-5).
 */
export const HOST_BUILTINS: BuiltinExtension[] = []

export function getHostBuiltins(
  opts: { mobile?: boolean } = {}
): BuiltinExtension[] {
  return HOST_BUILTINS.filter((b) => (opts.mobile ? b.mobile : true))
}
