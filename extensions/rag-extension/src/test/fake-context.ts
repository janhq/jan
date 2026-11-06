import { vi } from 'vitest'
import {
  createInternalToolRegistry,
  createServiceRegistry,
  type InternalExtensionContext,
  type VectorDBService,
  ServiceKeys,
} from '@janhq/core'
import pkg from '../../package.json'
import type { SettingValue, SettingsApi } from '../settings'

type SettingContribution = {
  key: string
  control:
    | { type: 'checkbox'; default: boolean }
    | { type: 'dropdown'; options: { value: string }[]; default: string }
    | { type: 'slider'; min: number; max: number; default: number }
}

type Listener = (e: { key: string; value: SettingValue }) => void

const declared = pkg.jan.contributes.settings as SettingContribution[]

function fits(setting: SettingContribution, value: SettingValue): boolean {
  const c = setting.control
  switch (c.type) {
    case 'checkbox':
      return typeof value === 'boolean'
    case 'dropdown':
      return typeof value === 'string' && c.options.some((o) => o.value === value)
    case 'slider':
      return typeof value === 'number' && value >= c.min && value <= c.max
  }
}

/**
 * The settings store as the host runs it for this manifest: declared keys
 * only, values checked against their control, defaults from the manifest.
 */
export function fakeSettings(initial: Record<string, SettingValue> = {}) {
  const values = new Map(Object.entries(initial))
  const listeners: Listener[] = []
  const byKey = new Map(declared.map((s) => [s.key, s]))
  const api: SettingsApi = {
    get: async <T extends SettingValue>(key: string) => {
      const setting = byKey.get(key)
      if (!setting) return undefined
      return (values.get(key) ?? setting.control.default) as T
    },
    set: async (key, value) => {
      const setting = byKey.get(key)
      if (!setting) throw new Error(`Setting '${key}' is not declared`)
      if (!fits(setting, value)) throw new Error(`Value for '${key}' does not fit`)
      values.set(key, value)
      listeners.forEach((l) => l({ key, value }))
    },
    onDidChange: (listener) => {
      listeners.push(listener)
      return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) }
    },
  }
  return { api, values }
}

export function fakeContext(
  opts: { vectorDB?: Partial<VectorDBService>; settings?: Record<string, SettingValue> } = {}
) {
  const services = createServiceRegistry()
  const tools = createInternalToolRegistry()
  if (opts.vectorDB) services.provide(ServiceKeys.VectorDB, opts.vectorDB as VectorDBService)
  const settings = fakeSettings(opts.settings)
  const disposables: { dispose(): void }[] = []
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const ctx = {
    extension: { id: 'jan.rag', version: '0.1.0', displayName: 'RAG Tools' },
    subscriptions: {
      add: <T extends { dispose(): void }>(d: T) => (disposables.push(d), d),
      dispose: () => disposables.splice(0).reverse().forEach((d) => d.dispose()),
    },
    log,
    settings: settings.api,
    internal: { services, tools },
  } as unknown as InternalExtensionContext
  return { ctx, services, tools, settings, log }
}
