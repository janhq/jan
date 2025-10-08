import { createFileRoute } from '@tanstack/react-router'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { useAttachments } from '@/hooks/useAttachments'
import type { SettingComponentProps } from '@janhq/core'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { PlatformFeature } from '@/lib/platform/types'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'

export const Route = createFileRoute('/settings/attachments')({
  component: AttachmentsSettings,
})

// Helper to extract constraints from settingsDefs
function getConstraints(def: SettingComponentProps) {
  const props = def.controllerProps as Partial<{ min: number; max: number; step: number }>
  return {
    min: props.min ?? -Infinity,
    max: props.max ?? Infinity,
    step: props.step ?? 1,
  }
}

// Helper to validate and clamp numeric values
function clampValue(val: unknown, def: SettingComponentProps, currentValue: number): number {
  const num = typeof val === 'number' ? val : Number(val)
  if (!Number.isFinite(num)) return currentValue
  const { min, max, step } = getConstraints(def)
  // Floor integer values, preserve decimals for threshold
  const adjusted = step >= 1 ? Math.floor(num) : num
  return Math.max(min, Math.min(max, adjusted))
}

function AttachmentsSettings() {
  const { t } = useTranslation()
  const hookDefs = useAttachments((s) => s.settingsDefs)
  const loadDefs = useAttachments((s) => s.loadSettingsDefs)
  const [defs, setDefs] = useState<SettingComponentProps[]>([])

  // Load schema from extension via the hook once
  useEffect(() => {
    loadDefs()
  }, [loadDefs])

  // Mirror the hook's defs into local state for display
  useEffect(() => {
    setDefs(hookDefs)
  }, [hookDefs])

  // Track values for live updates
  const sel = useAttachments(
    useShallow((s) => ({
      enabled: s.enabled,
      maxFileSizeMB: s.maxFileSizeMB,
      retrievalLimit: s.retrievalLimit,
      retrievalThreshold: s.retrievalThreshold,
      chunkSizeTokens: s.chunkSizeTokens,
      overlapTokens: s.overlapTokens,
      searchMode: s.searchMode,
      setEnabled: s.setEnabled,
      setMaxFileSizeMB: s.setMaxFileSizeMB,
      setRetrievalLimit: s.setRetrievalLimit,
      setRetrievalThreshold: s.setRetrievalThreshold,
      setChunkSizeTokens: s.setChunkSizeTokens,
      setOverlapTokens: s.setOverlapTokens,
      setSearchMode: s.setSearchMode,
    }))
  )

  // Local state for inputs to allow intermediate values while typing
  const [localValues, setLocalValues] = useState<Record<string, string | number | boolean | string[]>>({})

  // Debounce timers
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      Object.values(timers).forEach(clearTimeout)
    }
  }, [])

  // Debounced setter with validation
  const debouncedSet = useCallback((key: string, val: unknown, def: SettingComponentProps) => {
    // Clear existing timer for this key
    if (timersRef.current[key]) {
      clearTimeout(timersRef.current[key])
    }

    // Set local value immediately for responsive UI
    setLocalValues((prev) => ({
      ...prev,
      [key]: val as string | number | boolean | string[]
    }))

    // For non-numeric inputs, apply immediately without debounce
    if (key === 'enabled' || key === 'search_mode') {
      if (key === 'enabled') sel.setEnabled(!!val)
      else if (key === 'search_mode') sel.setSearchMode(val as 'auto' | 'ann' | 'linear')
      return
    }

    // For numeric inputs, debounce the validation and sync
    timersRef.current[key] = setTimeout(() => {
      const currentStoreValue = (() => {
        switch (key) {
          case 'max_file_size_mb': return sel.maxFileSizeMB
          case 'retrieval_limit': return sel.retrievalLimit
          case 'retrieval_threshold': return sel.retrievalThreshold
          case 'chunk_size_tokens': return sel.chunkSizeTokens
          case 'overlap_tokens': return sel.overlapTokens
          default: return 0
        }
      })()

      const validated = clampValue(val, def, currentStoreValue)

      switch (key) {
        case 'max_file_size_mb':
          sel.setMaxFileSizeMB(validated)
          break
        case 'retrieval_limit':
          sel.setRetrievalLimit(validated)
          break
        case 'retrieval_threshold':
          sel.setRetrievalThreshold(validated)
          break
        case 'chunk_size_tokens':
          sel.setChunkSizeTokens(validated)
          break
        case 'overlap_tokens':
          sel.setOverlapTokens(validated)
          break
      }

      // Update local value to validated one
      setLocalValues((prev) => ({
        ...prev,
        [key]: validated as string | number | boolean | string[]
      }))
    }, 500) // 500ms debounce
  }, [sel])

  return (
    <PlatformGuard feature={PlatformFeature.ATTACHMENTS}>
      <div className="flex flex-col h-full pb-[calc(env(safe-area-inset-bottom)+env(safe-area-inset-top))]">
        <HeaderPage>
          <h1 className="font-medium">{t('common:settings')}</h1>
        </HeaderPage>
        <div className="flex h-full w-full flex-col sm:flex-row">
          <SettingsMenu />
          <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
            <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
              <Card title={t('common:attachments') || 'Attachments'}>
                {defs.map((d) => {
                  // Use local value if typing, else use store value
                  const storeValue = (() => {
                    switch (d.key) {
                      case 'enabled':
                        return sel.enabled
                      case 'max_file_size_mb':
                        return sel.maxFileSizeMB
                      case 'retrieval_limit':
                        return sel.retrievalLimit
                      case 'retrieval_threshold':
                        return sel.retrievalThreshold
                      case 'chunk_size_tokens':
                        return sel.chunkSizeTokens
                      case 'overlap_tokens':
                        return sel.overlapTokens
                      case 'search_mode':
                        return sel.searchMode
                      default:
                        return d?.controllerProps?.value
                    }
                  })()

                  const currentValue =
                    localValues[d.key] !== undefined ? localValues[d.key] : storeValue

                  // Convert to DynamicControllerSetting compatible props
                  const baseProps = d.controllerProps
                  const normalizedValue: string | number | boolean = (() => {
                    if (Array.isArray(currentValue)) {
                      return currentValue.join(',')
                    }
                    return currentValue as string | number | boolean
                  })()

                  const props = {
                    value: normalizedValue,
                    placeholder: 'placeholder' in baseProps ? baseProps.placeholder : undefined,
                    type: 'type' in baseProps ? baseProps.type : undefined,
                    options: 'options' in baseProps ? baseProps.options : undefined,
                    input_actions: 'inputActions' in baseProps ? baseProps.inputActions : undefined,
                    rows: undefined,
                    min: 'min' in baseProps ? baseProps.min : undefined,
                    max: 'max' in baseProps ? baseProps.max : undefined,
                    step: 'step' in baseProps ? baseProps.step : undefined,
                    recommended: 'recommended' in baseProps ? baseProps.recommended : undefined,
                  }

                  const title = d.titleKey ? t(d.titleKey) : d.title
                  const description = d.descriptionKey ? t(d.descriptionKey) : d.description

                  return (
                    <CardItem
                      key={d.key}
                      title={title}
                      description={description}
                      actions={
                        <DynamicControllerSetting
                          controllerType={d.controllerType}
                          controllerProps={props}
                          onChange={(val) => debouncedSet(d.key, val, d)}
                        />
                      }
                    />
                  )
                })}
              </Card>
            </div>
          </div>
        </div>
      </div>
    </PlatformGuard>
  )
}
