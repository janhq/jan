import { create } from 'zustand'
import type { SettingComponentProps } from '@janhq/core'
import type { SettingContribution, SettingValue } from '@janhq/extension-api'
import { getExtensionHost } from '@/lib/extensions/host'

/** The rag built-in, whose settings these are. */
export const RAG_EXTENSION_ID = 'jan.rag'

export type AttachmentsSettings = {
  enabled: boolean
  maxFileSizeMB: number
  retrievalLimit: number
  retrievalThreshold: number
  chunkSizeChars: number
  overlapChars: number
  searchMode: 'auto' | 'ann' | 'linear'
  parseMode: 'auto' | 'inline' | 'embeddings' | 'prompt'
  autoInlineContextRatio: number
}

type AttachmentsStore = AttachmentsSettings & {
  // Dynamic controller definitions for rendering UI
  settingsDefs: SettingComponentProps[]
  loadSettingsDefs: () => Promise<boolean>
  setEnabled: (v: boolean) => Promise<void>
  setMaxFileSizeMB: (v: number) => Promise<void>
  setRetrievalLimit: (v: number) => Promise<void>
  setRetrievalThreshold: (v: number) => Promise<void>
  setChunkSizeChars: (v: number) => Promise<void>
  setOverlapChars: (v: number) => Promise<void>
  setSearchMode: (v: 'auto' | 'ann' | 'linear') => Promise<void>
  setParseMode: (v: 'auto' | 'inline' | 'embeddings' | 'prompt') => Promise<void>
  setAutoInlineContextRatio: (v: number) => Promise<void>
}

// Setting key -> store field and the i18n stem of its title/description.
const FIELDS: Record<string, { field: keyof AttachmentsSettings; i18n: string }> = {
  enabled: { field: 'enabled', i18n: 'enable' },
  parse_mode: { field: 'parseMode', i18n: 'parseMode' },
  auto_inline_context_ratio: {
    field: 'autoInlineContextRatio',
    i18n: 'autoInlineThreshold',
  },
  max_file_size_mb: { field: 'maxFileSizeMB', i18n: 'maxFile' },
  retrieval_limit: { field: 'retrievalLimit', i18n: 'topK' },
  retrieval_threshold: { field: 'retrievalThreshold', i18n: 'threshold' },
  chunk_size_chars: { field: 'chunkSizeChars', i18n: 'chunkSize' },
  overlap_chars: { field: 'overlapChars', i18n: 'chunkOverlap' },
  search_mode: { field: 'searchMode', i18n: 'searchMode' },
}

/**
 * The page's controller definition of a declared setting. Numeric settings
 * are sliders in the manifest (so the store range-checks them) but render
 * here as number inputs, as the page always has.
 */
function toDef(
  setting: SettingContribution,
  value: SettingValue
): SettingComponentProps {
  const i18n = FIELDS[setting.key]?.i18n
  const base = {
    key: setting.key,
    title: setting.title,
    description: setting.description ?? '',
    titleKey: i18n ? `settings:attachments.${i18n}` : undefined,
    descriptionKey: i18n ? `settings:attachments.${i18n}Desc` : undefined,
  }
  const { control } = setting
  switch (control.type) {
    case 'checkbox':
      return { ...base, controllerType: 'checkbox', controllerProps: { value: Boolean(value) } }
    case 'dropdown':
      return {
        ...base,
        controllerType: 'dropdown',
        controllerProps: {
          value: String(value),
          options: control.options.map((o) => ({ name: o.label, value: o.value })),
        },
      }
    case 'slider':
      return {
        ...base,
        controllerType: 'input',
        // The number itself, as the legacy definitions held it.
        controllerProps: {
          value,
          placeholder: '',
          type: 'number',
          textAlign: 'right',
          min: control.min,
          max: control.max,
          step: control.step,
        } as SettingComponentProps['controllerProps'],
      }
    default:
      return {
        ...base,
        controllerType: 'input',
        controllerProps: { value: String(value), placeholder: '' },
      }
  }
}

const declaredSettings = (): SettingContribution[] =>
  getExtensionHost()
    .list()
    .find((e) => e.id === RAG_EXTENSION_ID && e.state === 'active')?.manifest
    .contributes?.settings ?? []

const withValue = (
  defs: SettingComponentProps[],
  key: string,
  value: SettingValue
): SettingComponentProps[] =>
  defs.map((d) =>
    d.key === key
      ? ({
          ...d,
          controllerProps: { ...d.controllerProps, value },
        } as SettingComponentProps)
      : d
  )

export const useAttachments = create<AttachmentsStore>()((set) => {
  // The store updates from the settings change event, so an edit made on
  // Settings > Extensions shows here too. The page calls these without
  // awaiting, so a refused write is logged rather than rejected.
  const persist = async (key: string, value: SettingValue) => {
    try {
      await getExtensionHost().settings.setSettingValue(RAG_EXTENSION_ID, key, value)
    } catch (e) {
      console.error(`Failed to save attachment setting '${key}':`, e)
    }
  }
  return {
    enabled: true,
    maxFileSizeMB: 100,
    retrievalLimit: 3,
    retrievalThreshold: 0.3,
    chunkSizeChars: 512,
    overlapChars: 64,
    searchMode: 'auto',
    parseMode: 'auto',
    autoInlineContextRatio: 0.75,
    settingsDefs: [],
    loadSettingsDefs: async () => {
      const declared = declaredSettings()
      if (declared.length === 0) return false
      try {
        const store = getExtensionHost().settings
        const values = await Promise.all(
          declared.map(
            async (s) =>
              [s, (await store.getSettingValue(RAG_EXTENSION_ID, s.key)) ?? s.control.default] as const
          )
        )
        const patch: Partial<AttachmentsSettings> = {}
        for (const [s, value] of values) {
          const field = FIELDS[s.key]?.field
          if (field) Object.assign(patch, { [field]: value })
        }
        set({ ...patch, settingsDefs: values.map(([s, v]) => toDef(s, v)) })
        return true
      } catch (e) {
        console.debug('Failed to load attachment settings defs:', e)
        return false
      }
    },
    setEnabled: (v) => persist('enabled', !!v),
    setMaxFileSizeMB: (v) => persist('max_file_size_mb', v),
    setRetrievalLimit: (v) => persist('retrieval_limit', v),
    setRetrievalThreshold: (v) => persist('retrieval_threshold', v),
    setChunkSizeChars: (v) => persist('chunk_size_chars', v),
    setOverlapChars: (v) => persist('overlap_chars', v),
    setSearchMode: (v) => persist('search_mode', v),
    setParseMode: (v) => persist('parse_mode', v),
    setAutoInlineContextRatio: (v) => persist('auto_inline_context_ratio', v),
  }
})

function applyChange(key: string, value: SettingValue) {
  const field = FIELDS[key]?.field
  if (!field) return
  useAttachments.setState((s) => ({
    [field]: value,
    settingsDefs: withValue(s.settingsDefs, key, value),
  }))
}

/**
 * Follows the rag built-in: loads its settings once it is active (and
 * again whenever the host's extensions change), then every change to them.
 */
export function initAttachments(): () => void {
  const host = getExtensionHost()
  const load = () => void useAttachments.getState().loadSettingsDefs()
  const extensions = host.onDidChange(load)
  const changes = host.settings.onDidChange((change) => {
    if (change.extensionId === RAG_EXTENSION_ID) applyChange(change.key, change.value)
  })
  load()
  return () => {
    extensions.dispose()
    changes.dispose()
  }
}

if (process.env.NODE_ENV !== 'test') {
  initAttachments()
}
