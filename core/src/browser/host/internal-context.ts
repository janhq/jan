import type { ExtensionContext } from '@janhq/extension-api'
import type { downloads } from '../download'
import type { EngineManager } from '../extensions/engines/EngineManager'
import type { fs } from '../fs'
import type { appSettings } from '../settings'
import type { ServiceRegistry } from './services'

/** Keyring key the app stores the Hugging Face access token under. */
export const HUGGINGFACE_TOKEN_SECRET_KEY = 'huggingface'

/**
 * Read access to the app's own keyring entries (provider keys, the Hugging
 * Face token). Unlike `ctx.settings`, keys are not scoped to the extension:
 * a built-in reads the secret the app owns instead of keeping its own copy.
 */
export interface HostSecretsReader {
  /** The stored value, or null when the key is not set. */
  get(key: string): Promise<string | null>
}

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
    readonly secrets: HostSecretsReader
    /** Registers inference engines; disposing a registration removes it. */
    readonly engines: Pick<EngineManager, 'register'>
  }
}
