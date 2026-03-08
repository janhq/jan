import { create } from 'zustand'
import { ExtensionManager } from '@/lib/extension'
import {
  ExtensionTypeEnum,
  type RAGExtension,
  type SettingComponentProps,
} from '@janhq/core'

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
  setEnabled: (v: boolean) => void
  setMaxFileSizeMB: (v: number) => void
  setRetrievalLimit: (v: number) => void
  setRetrievalThreshold: (v: number) => void
  setChunkSizeChars: (v: number) => void
  setOverlapChars: (v: number) => void
  setSearchMode: (v: 'auto' | 'ann' | 'linear') => void
  setParseMode: (v: 'auto' | 'inline' | 'embeddings' | 'prompt') => void
  setAutoInlineContextRatio: (v: number) => void
}

const getRagExtension = (): RAGExtension | undefined => {
  try {
    return ExtensionManager.getInstance().get<RAGExtension>(
      ExtensionTypeEnum.RAG
    )
  } catch {
    return undefined
  }
}

export const useAttachments = create<AttachmentsStore>()((set) => ({
  enabled: true,
  maxFileSizeMB: 20,
  retrievalLimit: 3,
  retrievalThreshold: 0.3,
  chunkSizeChars: 512,
  overlapChars: 64,
  searchMode: 'auto',
  parseMode: 'auto',
  autoInlineContextRatio: 0.75,
  settingsDefs: [],
  loadSettingsDefs: async () => {
    const ext = getRagExtension()
    if (!ext?.getSettings) return false
    try {
      const defs = await ext.getSettings()
      if (!Array.isArray(defs)) return false

      const map = new Map<string, unknown>()
      defs.forEach((setting) =>
        map.set(setting.key, setting?.controllerProps?.value)
      )

      set((prev) => ({
        settingsDefs: defs,
        enabled: (map.get('enabled') as boolean | undefined) ?? prev.enabled,
        maxFileSizeMB:
          (map.get('max_file_size_mb') as number | undefined) ??
          prev.maxFileSizeMB,
        retrievalLimit:
          (map.get('retrieval_limit') as number | undefined) ??
          prev.retrievalLimit,
        retrievalThreshold:
          (map.get('retrieval_threshold') as number | undefined) ??
          prev.retrievalThreshold,
        chunkSizeChars:
          (map.get('chunk_size_chars') as number | undefined) ??
          (map.get('chunk_size_tokens') as number | undefined) ??
          prev.chunkSizeChars,
        overlapChars:
          (map.get('overlap_chars') as number | undefined) ??
          (map.get('overlap_tokens') as number | undefined) ??
          prev.overlapChars,
        searchMode:
          (map.get('search_mode') as 'auto' | 'ann' | 'linear' | undefined) ??
          prev.searchMode,
        parseMode:
          (map.get('parse_mode') as
            | 'auto'
            | 'inline'
            | 'embeddings'
            | 'prompt'
            | undefined) ?? prev.parseMode,
        autoInlineContextRatio:
          (map.get('auto_inline_context_ratio') as number | undefined) ??
          prev.autoInlineContextRatio,
      }))

      return true
    } catch (e) {
      console.debug('Failed to load attachment settings defs:', e)
      return false
    }
  },
  setEnabled: async (v) => {
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'enabled',
          controllerProps: { value: !!v },
        } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      enabled: v,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'enabled'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: !!v },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setMaxFileSizeMB: async (val) => {
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'max_file_size_mb',
          controllerProps: { value: val },
        } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      maxFileSizeMB: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'max_file_size_mb'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setRetrievalLimit: async (val) => {
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'retrieval_limit',
          controllerProps: { value: val },
        } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      retrievalLimit: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'retrieval_limit'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setRetrievalThreshold: async (val) => {
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'retrieval_threshold',
          controllerProps: { value: val },
        } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      retrievalThreshold: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'retrieval_threshold'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setChunkSizeChars: async (val) => {
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'chunk_size_chars',
          controllerProps: { value: val },
        } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      chunkSizeChars: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'chunk_size_chars'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setOverlapChars: async (val) => {
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'overlap_chars',
          controllerProps: { value: val },
        } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      overlapChars: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'overlap_chars'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setSearchMode: async (v) => {
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'search_mode',
          controllerProps: { value: v },
        } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      searchMode: v,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'search_mode'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: v },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setParseMode: async (v) => {
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'parse_mode',
          controllerProps: { value: v },
        } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      parseMode: v,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'parse_mode'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: v },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setAutoInlineContextRatio: async (val) => {
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'auto_inline_context_ratio',
          controllerProps: { value: val },
        } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      autoInlineContextRatio: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'auto_inline_context_ratio'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
}))

// Attempt to hydrate settings from the RAG extension, retrying briefly until it is registered
const MAX_INIT_ATTEMPTS = 5
const INIT_RETRY_DELAY_MS = 300
;(async () => {
  for (let i = 0; i < MAX_INIT_ATTEMPTS; i += 1) {
    const success = await useAttachments.getState().loadSettingsDefs()
    if (success) return
    await new Promise((resolve) => setTimeout(resolve, INIT_RETRY_DELAY_MS))
  }
})()
