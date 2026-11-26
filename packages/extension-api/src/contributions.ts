import type { ModelCapability } from './capabilities.js'

/** A JSON value as it survives `JSON.stringify` and structured clone alike. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject
export interface JsonObject {
  [key: string]: JsonValue
}

/** A JSON Schema whose root describes an object, as tool inputs must. */
export interface JsonSchemaObject {
  type: 'object'
  properties?: Record<string, JsonObject>
  required?: string[]
  [keyword: string]: JsonValue | undefined
}

/** Places in the host UI where contributed commands can appear. */
export type MenuLocation =
  | 'commandPalette'
  | 'thread/context'
  | 'message/actions'
  | 'chatInput/actions'

/** The closed set of visibility conditions for menu items. */
export type WhenClause =
  | 'always'
  | 'message.role == assistant'
  | 'message.role == user'
  | 'thread.hasMessages'

/**
 * Text fields accept a literal or `%key%`, which the host resolves through
 * the manifest `l10n` table.
 */
export interface CommandContribution {
  id: string
  title: string
  category?: string
  /** A Tabler icon name in kebab case, for example `hand-stop`. */
  icon?: string
}

export interface MenuItemContribution {
  /** The id of a command declared in the same manifest. */
  command: string
  when?: WhenClause
  group?: string
  order?: number
}

export interface StatusItemContribution {
  id: string
  text: string
  tooltip?: string
  /** The id of a command declared in the same manifest, run on click. */
  command?: string
  priority?: number
}

export type SettingControl =
  | {
      type: 'input'
      inputType?: 'text' | 'url' | 'number'
      placeholder?: string
      default: string
    }
  | { type: 'checkbox'; default: boolean }
  | {
      type: 'dropdown'
      options: { value: string; label: string }[]
      default: string
    }
  | { type: 'slider'; min: number; max: number; step: number; default: number }
  | { type: 'textarea'; rows?: number; default: string }

/** A setting value; its type follows the control's `default`. */
export type SettingValue = SettingControl['default']

export interface SettingContribution {
  key: string
  title: string
  description?: string
  /** Stored in the OS keyring instead of the settings file. */
  secret?: boolean
  control: SettingControl
}

/** Declared statically so the consent screen can list tools before install. */
export interface ToolContribution {
  name: string
  description: string
  inputSchema: JsonSchemaObject
}

export interface ProviderContribution {
  id: string
  displayName: string
  /** An OpenAI-compatible base URL; its host needs a `network:` permission. */
  baseUrl: string
  /** The key of a secret setting holding the API key. */
  apiKeySetting?: string
  /**
   * What every model of this provider can do, unless its `listModels` entry
   * says otherwise. Defaults to `['completion']`; declare `tools` for chat
   * to offer tool calls.
   */
  capabilities?: ModelCapability[]
}

export interface Contributions {
  settings?: SettingContribution[]
  commands?: CommandContribution[]
  menus?: Partial<Record<MenuLocation, MenuItemContribution[]>>
  statusItems?: StatusItemContribution[]
  tools?: ToolContribution[]
  providers?: ProviderContribution[]
}
