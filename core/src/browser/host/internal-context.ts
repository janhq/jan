import type { ExtensionContext } from '@janhq/extension-api'
import type { downloads } from '../download'
import type { EngineManager } from '../extensions/engines/EngineManager'
import type { fs } from '../fs'
import type { appSettings } from '../settings'
import type { ServiceRegistry } from './services'
import type { InternalToolRegistry } from './tools'

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
 * `fetch` for Jan's own servers on loopback (the llama.cpp engine, MLX). The
 * host sends it from the native HTTP client with every proxy bypassed, so a
 * system, environment or VPN proxy never captures a local request; the body
 * streams as it arrives. `connectTimeout` is in milliseconds. Never for a
 * remote provider, which must keep honouring the user's proxy.
 */
export type LoopbackFetch = (
  input: string | URL | Request,
  init?: RequestInit & { connectTimeout?: number }
) => Promise<Response>

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
    /** Tools offered under their plain names and never prompted for. */
    readonly tools: InternalToolRegistry
    readonly loopbackFetch: LoopbackFetch
  }
}
