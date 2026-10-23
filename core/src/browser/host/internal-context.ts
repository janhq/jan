import type { ExtensionContext } from '@janhq/extension-api'
import type { downloads } from '../download'
import type { fs } from '../fs'
import type { appSettings } from '../settings'
import type { ServiceRegistry } from './services'

/**
 * The context in-process built-ins receive. `internal` reaches host
 * facilities that third-party extensions never get; it carries no stability
 * guarantee and lives here rather than in `@janhq/extension-api` for that
 * reason.
 */
export interface InternalExtensionContext extends ExtensionContext {
  readonly internal: {
    readonly services: ServiceRegistry
    readonly fs: typeof fs
    readonly appSettings: typeof appSettings
    readonly downloads: typeof downloads
  }
}
