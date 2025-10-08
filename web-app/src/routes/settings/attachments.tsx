import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { useAttachments } from '@/hooks/useAttachments'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { PlatformFeature } from '@/lib/platform/types'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.attachments as any)({
  component: AttachmentsSettings,
})

// Helper to extract constraints from settingsDefs
function getConstraints(def: any) {
  const props = def?.controllerProps || {}
  return {
    min: props.min ?? -Infinity,
    max: props.max ?? Infinity,
    step: props.step ?? 1,
  }
}

// Helper to validate and clamp numeric values
function clampValue(val: any, def: any, currentValue: number): number {
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
  const [defs, setDefs] = useState<any[]>([])

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
  const [localValues, setLocalValues] = useState<Record<string, any>>({})

  // Debounce timers
  const timersRef = useRef<Record<string, NodeJS.Timeout>>({})

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(clearTimeout)
    }
  }, [])

  // Debounced setter with validation
  const debouncedSet = useCallback((key: string, val: any, def: any) => {
    // Clear existing timer for this key
    if (timersRef.current[key]) {
      clearTimeout(timersRef.current[key])
    }

    // Set local value immediately for responsive UI
    setLocalValues((prev) => ({ ...prev, [key]: val }))

    // For non-numeric inputs, apply immediately without debounce
    if (key === 'enabled' || key === 'search_mode') {
      if (key === 'enabled') sel.setEnabled(!!val)
      else if (key === 'search_mode') sel.setSearchMode(val)
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
      setLocalValues((prev) => ({ ...prev, [key]: validated }))
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

                  const currentValue = localValues[d.key] !== undefined ? localValues[d.key] : storeValue
                  const props = { ...(d.controllerProps || {}), value: currentValue }

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
                          controllerProps={props as any}
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
