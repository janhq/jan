import {
  Emitter,
  ExtensionError,
  toDisposable,
  type Disposable,
  type Event,
  type SettingContribution,
  type SettingValue,
  type ValidatedManifest,
} from '@janhq/extension-api'

/** The subset of `@janhq/core` `appSettings` the store needs. */
export interface AppSettingsBackend {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

/** The OS keyring; an empty value deletes the entry, as `set_secret` does. */
export interface SecretBackend {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

export interface SettingChange {
  extensionId: string
  key: string
  value: SettingValue
}

const settingsKey = (extensionId: string) => `extension:${extensionId}:settings`
const secretKey = (extensionId: string, key: string) =>
  `ext:${extensionId}:${key}`

function fitsControl(
  setting: SettingContribution,
  value: SettingValue
): boolean {
  const control = setting.control
  switch (control.type) {
    case 'input':
    case 'textarea':
      return typeof value === 'string'
    case 'checkbox':
      return typeof value === 'boolean'
    case 'dropdown':
      return (
        typeof value === 'string' &&
        control.options.some((o) => o.value === value)
      )
    case 'slider':
      return (
        typeof value === 'number' &&
        value >= control.min &&
        value <= control.max
      )
  }
}

/**
 * Setting values of host extensions. Schemas come from the manifests; only
 * values are stored: plain ones as one JSON object per extension in
 * `<jan_data>/settings.json`, secret ones in the OS keyring so they never
 * touch a file.
 */
export class ExtensionSettingsStore {
  private readonly schemas = new Map<string, Map<string, SettingContribution>>()
  // Each extension's values load once; later reads hit the cache, which every
  // write keeps current.
  private readonly values = new Map<
    string,
    Promise<Record<string, SettingValue>>
  >()
  private readonly changes = new Emitter<SettingChange>()
  private writes: Promise<unknown> = Promise.resolve()

  readonly onDidChange: Event<SettingChange> = this.changes.event

  constructor(
    private readonly backends: {
      appSettings: AppSettingsBackend
      secrets: SecretBackend
    }
  ) {}

  /** Makes the declared settings of `manifest` readable; dispose to forget them. */
  register(manifest: ValidatedManifest): Disposable {
    const { id } = manifest
    const schema = new Map(
      (manifest.contributes?.settings ?? []).map((s) => [s.key, s])
    )
    this.schemas.set(id, schema)
    return toDisposable(() => {
      if (this.schemas.get(id) !== schema) return
      this.schemas.delete(id)
      this.values.delete(id)
    })
  }

  /** The stored value, else the manifest default; undefined for an undeclared key. */
  async getSettingValue(
    extensionId: string,
    key: string
  ): Promise<SettingValue | undefined> {
    const setting = this.schemas.get(extensionId)?.get(key)
    if (!setting) return undefined
    if (setting.secret) {
      return (
        (await this.backends.secrets.get(secretKey(extensionId, key))) ??
        setting.control.default
      )
    }
    const stored = (await this.load(extensionId))[key]
    return stored ?? setting.control.default
  }

  async setSettingValue(
    extensionId: string,
    key: string,
    value: SettingValue
  ): Promise<void> {
    const setting = this.schemas.get(extensionId)?.get(key)
    if (!setting)
      throw new ExtensionError(
        'E_NOT_FOUND',
        `Setting '${key}' is not declared`
      )
    if (!fitsControl(setting, value)) {
      throw new ExtensionError(
        'E_INVALID_ARGS',
        `Value for '${key}' does not fit its ${setting.control.type} control`
      )
    }
    if (setting.secret) {
      await this.backends.secrets.set(
        secretKey(extensionId, key),
        value as string
      )
    } else {
      // Serialized so concurrent writes of different keys both land.
      const run = this.writes.then(async () => {
        const current = await this.load(extensionId)
        const next = { ...current, [key]: value }
        await this.backends.appSettings.set(
          settingsKey(extensionId),
          JSON.stringify(next)
        )
        this.values.set(extensionId, Promise.resolve(next))
      })
      this.writes = run.catch(() => undefined)
      await run
    }
    this.changes.fire({ extensionId, key, value })
  }

  private load(extensionId: string): Promise<Record<string, SettingValue>> {
    let loaded = this.values.get(extensionId)
    if (!loaded) {
      loaded = this.backends.appSettings
        .get(settingsKey(extensionId))
        .then((raw) =>
          raw ? (JSON.parse(raw) as Record<string, SettingValue>) : {}
        )
      // A failed read must not be cached, or the extension stays on defaults.
      loaded.catch(() => this.values.delete(extensionId))
      this.values.set(extensionId, loaded)
    }
    return loaded
  }
}
