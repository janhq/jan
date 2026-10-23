import { AIEngine, BaseExtension, ExtensionTypeEnum } from '@janhq/core'

import { getServiceHub } from '@/hooks/useServiceHub'

/**
 * Extension manifest object.
 */
export class Extension {
  /** @type {string} Name of the extension. */
  name: string

  /** @type {string} Product name of the extension. */
  productName?: string

  /** @type {string} The URL of the extension to load. */
  url: string

  /** @type {boolean} Whether the extension is activated or not. */
  active?: boolean

  /** @type {string} Extension's description. */
  description?: string

  /** @type {string} Extension's version. */
  version?: string

  /** @type {BaseExtension} Pre-loaded extension instance for web extensions. */
  extensionInstance?: BaseExtension

  constructor(
    url: string,
    name: string,
    productName?: string,
    active?: boolean,
    description?: string,
    version?: string,
    extensionInstance?: BaseExtension
  ) {
    this.name = name
    this.productName = productName
    this.url = url
    this.active = active
    this.description = description
    this.version = version
    this.extensionInstance = extensionInstance
  }
}

export type ExtensionManifest = {
  url: string
  name: string
  productName?: string
  active?: boolean
  description?: string
  version?: string
  extensionInstance?: BaseExtension // For web extensions
}

/**
 * Manages the registration and retrieval of extensions.
 */
export class ExtensionManager {
  date = new Date().toISOString()
  // Registered extensions
  private extensions = new Map<string, BaseExtension>()

  // Registered inference engines
  private engines = new Map<string, AIEngine>()

  // Notified whenever an extension registers, so consumers waiting on a
  // not-yet-ready extension (startup race) can re-attempt instead of polling.
  private registrationListeners = new Set<() => void>()

  /**
   * Registers an extension.
   * @param extension - The extension to register.
   */
  register<T extends BaseExtension>(name: string, extension: T) {
    // Register for naming use
    this.extensions.set(name, extension)

    // Register AI Engines
    if ('provider' in extension && typeof extension.provider === 'string') {
      this.engines.set(
        extension.provider as unknown as string,
        extension as unknown as AIEngine
      )
    }

    this.registrationListeners.forEach((cb) => cb())
  }

  /**
   * Subscribes to extension registrations. Returns an unsubscribe function.
   */
  onRegistrationChange(cb: () => void): () => void {
    this.registrationListeners.add(cb)
    return () => this.registrationListeners.delete(cb)
  }

  /**
   * Retrieves a extension by its type.
   * @param type - The type of the extension to retrieve.
   * @returns The extension, if found.
   */
  get<T extends BaseExtension>(type: ExtensionTypeEnum): T | undefined {
    return this.getAll().find((e) => e.type() === type) as T | undefined
  }

  /**
   * Retrieves a extension by its type.
   * @param type - The type of the extension to retrieve.
   * @returns The extension, if found.
   */
  getByName(name: string): BaseExtension | undefined {
    return this.extensions.get(name) as BaseExtension | undefined
  }

  /**
   * Retrieves a extension by its type.
   * @param type - The type of the extension to retrieve.
   * @returns The extension, if found.
   */
  getAll(): BaseExtension[] {
    return Array.from(this.extensions.values())
  }

  /**
   * Retrieves a extension by its type.
   * @param engine - The engine name to retrieve.
   * @returns The extension, if found.
   */
  getEngine<T extends AIEngine>(engine: string): T | undefined {
    return this.engines.get(engine) as T | undefined
  }

  /**
   * Loads all registered extension.
   */
  async load(onProgress?: (done: number, total: number) => void) {
    const exts = this.listExtensions()
    let done = 0
    onProgress?.(0, exts.length)
    const results = await Promise.allSettled(
      exts.map((ext) =>
        Promise.resolve(ext.onLoad()).finally(() =>
          onProgress?.(++done, exts.length)
        )
      )
    )
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const name = exts[i]?.name ?? `index ${i}`
        console.error(`Extension onLoad failed (${name}):`, r.reason)
      }
    })
  }

  /**
   * Unloads all registered extensions.
   */
  unload() {
    this.listExtensions().forEach((ext) => {
      ext.onUnload()
    })
  }

  /**
   * Retrieves a list of all registered extensions.
   * @returns An array of extensions.
   */
  listExtensions() {
    return [...this.extensions.values()]
  }

  /**
   * Retrieves a list of all registered extensions.
   * @returns An array of extensions.
   */
  async getActive(): Promise<Extension[]> {
    const manifests = await getServiceHub().core().getActiveExtensions()
    if (!manifests || !Array.isArray(manifests)) return []

    const extensions: Extension[] = manifests.map((manifest: ExtensionManifest) => {
      return new Extension(
        manifest.url,
        manifest.name,
        manifest.productName,
        manifest.active,
        manifest.description,
        manifest.version,
        manifest.extensionInstance // Pass the extension instance if available
      )
    })
    
    return extensions
  }

  /**
   * Registers an extension's pre-built instance.
   * @param {Extension} extension extension object as provided by the core service.
   * @returns {void}
   */
  activateExtension(extension: Extension) {
    if (!extension.extensionInstance) {
      console.error(`Extension '${extension.name}' has no instance to register`)
      return
    }
    this.register(extension.name, extension.extensionInstance)
  }

  /**
   * Registers all active extensions.
   * @returns {void}
   */
  async registerActive() {
    // Get active extensions
    const activeExtensions = await this.getActive()
    activeExtensions.forEach((ext) => this.activateExtension(ext))
  }

  /**
   * Shared instance of ExtensionManager.
   */
  static getInstance() {
    if (!window.core.extensionManager)
      window.core.extensionManager = new ExtensionManager()
    return window.core.extensionManager as ExtensionManager
  }
}
