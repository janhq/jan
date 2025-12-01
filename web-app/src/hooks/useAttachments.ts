import { create } from 'zustand'
import { ExtensionManager } from '@/lib/extension'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { ExtensionTypeEnum, type RAGExtension, type SettingComponentProps } from '@janhq/core'

export type AttachmentsSettings = {
  enabled: boolean
  maxFileSizeMB: number
  retrievalLimit: number
  retrievalThreshold: number
  chunkSizeTokens: number
  overlapTokens: number
  searchMode: 'auto' | 'ann' | 'linear'
  parseMode: 'auto' | 'inline' | 'embeddings' | 'prompt'
  autoInlineContextRatio: number
}

type AttachmentsStore = AttachmentsSettings & {
  // Dynamic controller definitions for rendering UI
  settingsDefs: SettingComponentProps[]
  loadSettingsDefs: () => Promise<void>
  setEnabled: (v: boolean) => void
  setMaxFileSizeMB: (v: number) => void
  setRetrievalLimit: (v: number) => void
  setRetrievalThreshold: (v: number) => void
  setChunkSizeTokens: (v: number) => void
  setOverlapTokens: (v: number) => void
  setSearchMode: (v: 'auto' | 'ann' | 'linear') => void
  setParseMode: (v: 'auto' | 'inline' | 'embeddings' | 'prompt') => void
  setAutoInlineContextRatio: (v: number) => void
}

const getRagExtension = (): RAGExtension | undefined => {
  try {
    return ExtensionManager.getInstance().get<RAGExtension>(ExtensionTypeEnum.RAG)
  } catch {
    return undefined
  }
}

const fileAttachmentsFeatureEnabled =
  PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS]

export const useAttachments = create<AttachmentsStore>()((set) => ({
  enabled: fileAttachmentsFeatureEnabled,
  maxFileSizeMB: 20,
  retrievalLimit: 3,
  retrievalThreshold: 0.3,
  chunkSizeTokens: 512,
  overlapTokens: 64,
  searchMode: 'auto',
  parseMode: 'auto',
  autoInlineContextRatio: 0.75,
  settingsDefs: [],
  loadSettingsDefs: async () => {
    const ext = getRagExtension()
    if (!ext?.getSettings) return
    try {
      const defs = await ext.getSettings()
      if (Array.isArray(defs)) set({ settingsDefs: defs })
    } catch (e) {
      console.debug('Failed to load attachment settings defs:', e)
    }
  },
  setEnabled: async (v) => {
    if (!fileAttachmentsFeatureEnabled) {
      set((s) => ({
        enabled: false,
        settingsDefs: s.settingsDefs.map((d) =>
          d.key === 'enabled'
            ? ({
                ...d,
                controllerProps: { ...d.controllerProps, value: false },
              } as SettingComponentProps)
            : d
        ),
      }))
      return
    }
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'enabled', controllerProps: { value: !!v } } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      enabled: v,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'enabled'
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: !!v } } as SettingComponentProps)
          : d
      ),
    }))
  },
  setMaxFileSizeMB: async (val) => {
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'max_file_size_mb', controllerProps: { value: val } } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      maxFileSizeMB: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'max_file_size_mb'
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: val } } as SettingComponentProps)
          : d
      ),
    }))
  },
  setRetrievalLimit: async (val) => {
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'retrieval_limit', controllerProps: { value: val } } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      retrievalLimit: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'retrieval_limit'
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: val } } as SettingComponentProps)
          : d
      ),
    }))
  },
  setRetrievalThreshold: async (val) => {
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'retrieval_threshold', controllerProps: { value: val } } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      retrievalThreshold: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'retrieval_threshold'
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: val } } as SettingComponentProps)
          : d
      ),
    }))
  },
  setChunkSizeTokens: async (val) => {
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'chunk_size_tokens', controllerProps: { value: val } } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      chunkSizeTokens: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'chunk_size_tokens'
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: val } } as SettingComponentProps)
          : d
      ),
    }))
  },
  setOverlapTokens: async (val) => {
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'overlap_tokens', controllerProps: { value: val } } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      overlapTokens: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'overlap_tokens'
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: val } } as SettingComponentProps)
          : d
      ),
    }))
  },
  setSearchMode: async (v) => {
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'search_mode', controllerProps: { value: v } } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      searchMode: v,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'search_mode'
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: v } } as SettingComponentProps)
          : d
      ),
    }))
  },
  setParseMode: async (v) => {
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'parse_mode', controllerProps: { value: v } } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      parseMode: v,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'parse_mode'
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: v } } as SettingComponentProps)
          : d
      ),
    }))
  },
  setAutoInlineContextRatio: async (val) => {
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'auto_inline_context_ratio', controllerProps: { value: val } } as Partial<SettingComponentProps>,
      ])
    }
    set((s) => ({
      autoInlineContextRatio: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'auto_inline_context_ratio'
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: val } } as SettingComponentProps)
          : d
      ),
    }))
  },
}))

// Initialize from extension settings once on import
;(async () => {
  try {
    const ext = getRagExtension()
    if (!ext?.getSettings) return
    const settings = await ext.getSettings()
    if (!Array.isArray(settings)) return
    const map = new Map<string, unknown>()
    for (const s of settings) map.set(s.key, s?.controllerProps?.value)
    // seed defs and values
    useAttachments.setState((prev) => ({
      settingsDefs: settings,
      enabled:
        fileAttachmentsFeatureEnabled &&
        ((map.get('enabled') as boolean | undefined) ?? prev.enabled),
      maxFileSizeMB: (map.get('max_file_size_mb') as number | undefined) ?? prev.maxFileSizeMB,
      retrievalLimit: (map.get('retrieval_limit') as number | undefined) ?? prev.retrievalLimit,
      retrievalThreshold:
        (map.get('retrieval_threshold') as number | undefined) ?? prev.retrievalThreshold,
      chunkSizeTokens: (map.get('chunk_size_tokens') as number | undefined) ?? prev.chunkSizeTokens,
      overlapTokens: (map.get('overlap_tokens') as number | undefined) ?? prev.overlapTokens,
      searchMode:
        (map.get('search_mode') as 'auto' | 'ann' | 'linear' | undefined) ?? prev.searchMode,
      parseMode:
        (map.get('parse_mode') as 'auto' | 'inline' | 'embeddings' | 'prompt' | undefined) ?? prev.parseMode,
      autoInlineContextRatio:
        (map.get('auto_inline_context_ratio') as number | undefined) ?? prev.autoInlineContextRatio,
    }))
  } catch (e) {
    console.debug('Failed to initialize attachment settings from extension:', e)
  }
})()
