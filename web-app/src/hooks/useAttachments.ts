import { create } from 'zustand'
import { ExtensionManager } from '@/lib/extension'
<<<<<<< HEAD
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { ExtensionTypeEnum, type RAGExtension, type SettingComponentProps } from '@janhq/core'
=======
import {
  ExtensionTypeEnum,
  type RAGExtension,
  type SettingComponentProps,
} from '@janhq/core'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

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
<<<<<<< HEAD
    return ExtensionManager.getInstance().get<RAGExtension>(ExtensionTypeEnum.RAG)
=======
    return ExtensionManager.getInstance().get<RAGExtension>(
      ExtensionTypeEnum.RAG
    )
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  } catch {
    return undefined
  }
}

<<<<<<< HEAD
const fileAttachmentsFeatureEnabled =
  PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS]

export const useAttachments = create<AttachmentsStore>()((set) => ({
  enabled: fileAttachmentsFeatureEnabled,
=======
export const useAttachments = create<AttachmentsStore>()((set) => ({
  enabled: true,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
      defs.forEach((setting) => map.set(setting.key, setting?.controllerProps?.value))

      set((prev) => ({
        settingsDefs: defs,
        enabled:
          fileAttachmentsFeatureEnabled &&
          ((map.get('enabled') as boolean | undefined) ?? prev.enabled),
        maxFileSizeMB:
          (map.get('max_file_size_mb') as number | undefined) ?? prev.maxFileSizeMB,
        retrievalLimit:
          (map.get('retrieval_limit') as number | undefined) ?? prev.retrievalLimit,
        retrievalThreshold:
          (map.get('retrieval_threshold') as number | undefined) ?? prev.retrievalThreshold,
=======
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
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
          (map.get('parse_mode') as 'auto' | 'inline' | 'embeddings' | 'prompt' | undefined) ??
          prev.parseMode,
=======
          (map.get('parse_mode') as
            | 'auto'
            | 'inline'
            | 'embeddings'
            | 'prompt'
            | undefined) ?? prev.parseMode,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
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
=======
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'enabled',
          controllerProps: { value: !!v },
        } as Partial<SettingComponentProps>,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      ])
    }
    set((s) => ({
      enabled: v,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'enabled'
<<<<<<< HEAD
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: !!v } } as SettingComponentProps)
=======
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: !!v },
            } as SettingComponentProps)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          : d
      ),
    }))
  },
  setMaxFileSizeMB: async (val) => {
<<<<<<< HEAD
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'max_file_size_mb', controllerProps: { value: val } } as Partial<SettingComponentProps>,
=======
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'max_file_size_mb',
          controllerProps: { value: val },
        } as Partial<SettingComponentProps>,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      ])
    }
    set((s) => ({
      maxFileSizeMB: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'max_file_size_mb'
<<<<<<< HEAD
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: val } } as SettingComponentProps)
=======
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          : d
      ),
    }))
  },
  setRetrievalLimit: async (val) => {
<<<<<<< HEAD
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'retrieval_limit', controllerProps: { value: val } } as Partial<SettingComponentProps>,
=======
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'retrieval_limit',
          controllerProps: { value: val },
        } as Partial<SettingComponentProps>,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      ])
    }
    set((s) => ({
      retrievalLimit: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'retrieval_limit'
<<<<<<< HEAD
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: val } } as SettingComponentProps)
=======
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          : d
      ),
    }))
  },
  setRetrievalThreshold: async (val) => {
<<<<<<< HEAD
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'retrieval_threshold', controllerProps: { value: val } } as Partial<SettingComponentProps>,
=======
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'retrieval_threshold',
          controllerProps: { value: val },
        } as Partial<SettingComponentProps>,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      ])
    }
    set((s) => ({
      retrievalThreshold: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'retrieval_threshold'
<<<<<<< HEAD
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: val } } as SettingComponentProps)
=======
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          : d
      ),
    }))
  },
  setChunkSizeChars: async (val) => {
<<<<<<< HEAD
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'chunk_size_chars', controllerProps: { value: val } } as Partial<SettingComponentProps>,
=======
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'chunk_size_chars',
          controllerProps: { value: val },
        } as Partial<SettingComponentProps>,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      ])
    }
    set((s) => ({
      chunkSizeChars: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'chunk_size_chars'
<<<<<<< HEAD
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: val } } as SettingComponentProps)
=======
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          : d
      ),
    }))
  },
  setOverlapChars: async (val) => {
<<<<<<< HEAD
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'overlap_chars', controllerProps: { value: val } } as Partial<SettingComponentProps>,
=======
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'overlap_chars',
          controllerProps: { value: val },
        } as Partial<SettingComponentProps>,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      ])
    }
    set((s) => ({
      overlapChars: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'overlap_chars'
<<<<<<< HEAD
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: val } } as SettingComponentProps)
=======
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          : d
      ),
    }))
  },
  setSearchMode: async (v) => {
<<<<<<< HEAD
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'search_mode', controllerProps: { value: v } } as Partial<SettingComponentProps>,
=======
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'search_mode',
          controllerProps: { value: v },
        } as Partial<SettingComponentProps>,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      ])
    }
    set((s) => ({
      searchMode: v,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'search_mode'
<<<<<<< HEAD
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: v } } as SettingComponentProps)
=======
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: v },
            } as SettingComponentProps)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          : d
      ),
    }))
  },
  setParseMode: async (v) => {
<<<<<<< HEAD
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'parse_mode', controllerProps: { value: v } } as Partial<SettingComponentProps>,
=======
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'parse_mode',
          controllerProps: { value: v },
        } as Partial<SettingComponentProps>,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      ])
    }
    set((s) => ({
      parseMode: v,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'parse_mode'
<<<<<<< HEAD
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: v } } as SettingComponentProps)
=======
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: v },
            } as SettingComponentProps)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          : d
      ),
    }))
  },
  setAutoInlineContextRatio: async (val) => {
<<<<<<< HEAD
    if (!fileAttachmentsFeatureEnabled) return
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        { key: 'auto_inline_context_ratio', controllerProps: { value: val } } as Partial<SettingComponentProps>,
=======
    const ext = getRagExtension()
    if (ext?.updateSettings) {
      await ext.updateSettings([
        {
          key: 'auto_inline_context_ratio',
          controllerProps: { value: val },
        } as Partial<SettingComponentProps>,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      ])
    }
    set((s) => ({
      autoInlineContextRatio: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'auto_inline_context_ratio'
<<<<<<< HEAD
          ? ({ ...d, controllerProps: { ...d.controllerProps, value: val } } as SettingComponentProps)
=======
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
