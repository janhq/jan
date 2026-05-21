import { IconSettings } from '@tabler/icons-react'
import debounce from 'lodash.debounce'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { cn, getModelDisplayName } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAppState } from '@/hooks/useAppState'

const MTP_MIN_BUILD = 9193

function parseBuildNumber(version: unknown): number | null {
  if (typeof version !== 'string') return null
  const m = version.match(/^b(\d+)$/)
  return m ? parseInt(m[1], 10) : null
}

type ModelSettingProps = {
  provider: ProviderObject
  model: Model
}

export function ModelSetting({
  model,
  provider,
}: ModelSettingProps) {
  const { updateProvider } = useModelProvider()
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const setActiveModels = useAppState((state) => state.setActiveModels)

  // Create a debounced version of stopModel that waits 500ms after the last call
  const debouncedStopModel = debounce((modelId: string) => {
    serviceHub
      .models()
      .stopModel(modelId)
      .then(() => {
        // Refresh active models after stopping
        serviceHub
          .models()
          .getActiveModels()
          .then((models) => setActiveModels(models || []))
      })
  }, 500)

  // Coalesce rapid sidebar edits into a single yaml-write + router-restart.
  // Each call merges into a per-model accumulator; the debounced flush writes
  // and clears it. Avoids a flurry of slider drags rewriting model.yml + bouncing
  // the router on every keystroke.
  const pendingPatchesRef = useRef<
    Map<string, Record<string, string | number | boolean | null | undefined>>
  >(new Map())
  const flushPendingPatches = useMemo(
    () =>
      debounce(() => {
        const patches = pendingPatchesRef.current
        pendingPatchesRef.current = new Map()
        for (const [modelId, patch] of patches) {
          serviceHub
            .models()
            .updateModelSettings(modelId, patch)
            .catch((e) => console.error('Failed to persist model settings', e))
        }
      }, 600),
    [serviceHub]
  )
  const debouncedPersistModelSettings = (
    modelId: string,
    patch: Record<string, string | number | boolean | null | undefined>
  ) => {
    const existing = pendingPatchesRef.current.get(modelId) ?? {}
    pendingPatchesRef.current.set(modelId, { ...existing, ...patch })
    flushPendingPatches()
  }

  const handleSettingChange = (
    key: string,
    value: string | boolean | number
  ) => {
    if (!provider) return

    // Create a copy of the model with updated settings
    const updatedModel = {
      ...model,
      settings: {
        ...model.settings,
        [key]: {
          ...(model.settings?.[key] != null ? model.settings?.[key] : {}),
          controller_props: {
            ...(model.settings?.[key]?.controller_props ?? {}),
            value: value,
          },
        },
      },
    }

    // Find the model index in the provider's models array
    const modelIndex = provider.models.findIndex((m) => m.id === model.id)

    if (modelIndex !== -1) {
      // Create a copy of the provider's models array
      const updatedModels = [...provider.models]

      // Update the specific model in the array
      updatedModels[modelIndex] = updatedModel as Model

      // Update the provider with the new models array
      updateProvider(provider.provider, {
        models: updatedModels,
      })

      // Call debounced stopModel only when updating settings that require restart,
      // and only if the model is currently running
      if (
        key === 'ctx_len' ||
        key === 'ngl' ||
        key === 'chat_template' ||
        key === 'offload_mmproj' ||
        key === 'batch_size' ||
        key === 'cpu_moe' ||
        key === 'n_cpu_moe'
      ) {
        // Check if model is running before stopping it
        serviceHub
          .models()
          .getActiveModels()
          .then((activeModels) => {
            if (activeModels.includes(model.id)) {
              debouncedStopModel(model.id)
            }
          })
      }

      // In router mode the router reads args from `router.preset.ini` (built
      // from `model.yml`) — Zustand alone has no effect on inference. Persist
      // mappable keys to disk + restart the router so the next load uses the
      // new args. Non-mappable keys are filtered inside the extension.
      if (provider.provider === 'llamacpp') {
        debouncedPersistModelSettings(model.id, { [key]: value })
      }
    }
  }

  const handleEngineSettingChange = (
    key: string,
    value: string | boolean | number
  ) => {
    if (!provider) return
    const newSettings = provider.settings.map((s) =>
      s.key === key
        ? {
            ...s,
            controller_props: { ...s.controller_props, value },
          }
        : s
    )
    serviceHub.providers().updateSettings(provider.provider, newSettings)
    updateProvider(provider.provider, { settings: newSettings })
  }

  const fitEnabled =
    provider.settings?.find((s) => s.key === 'fit')?.controller_props?.value ===
    true
  const fitCtxSetting = provider.settings?.find((s) => s.key === 'fit_ctx')

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-xs">
          <IconSettings size={18} className="text-muted-foreground" />
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {t('common:modelSettings.title', {
              modelId: getModelDisplayName(model),
            })}
          </SheetTitle>
          <SheetDescription className='text-xs leading-normal'>
            {t('common:modelSettings.description')}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-8 pb-4">
          {provider.provider === 'llamacpp' && (
            <MtpPanel modelId={model.id} provider={provider} />
          )}
          {fitEnabled && fitCtxSetting && (
            <div key="fit_ctx" className="space-y-2">
              <div className="flex items-start justify-between gap-8">
                <div className="mb-1 truncate">
                  <span title={fitCtxSetting.title} className="font-medium">
                    {fitCtxSetting.title}
                  </span>
                </div>
                <DynamicControllerSetting
                  key={fitCtxSetting.key}
                  title={fitCtxSetting.title}
                  description={fitCtxSetting.description}
                  controllerType={fitCtxSetting.controller_type}
                  controllerProps={fitCtxSetting.controller_props}
                  onChange={(newValue) =>
                    handleEngineSettingChange('fit_ctx', newValue)
                  }
                />
              </div>
              <p className="text-muted-foreground leading-normal text-xs">
                {fitCtxSetting.description}
              </p>
            </div>
          )}
          {(() => {
            return Object.entries(model.settings || {})
          .reduce<[string, unknown][]>((acc, entry) => {
            if (entry[0] === 'auto_increase_ctx_len') return acc
            if (entry[0] === 'reasoning') return acc
            if (fitEnabled && entry[0] === 'ctx_len') return acc
            if (entry[0] === 'ctx_len') {
              const autoIncrease = Object.entries(model.settings || {}).find(
                ([k]) => k === 'auto_increase_ctx_len'
              )
              if (autoIncrease) acc.push(autoIncrease)
            }
            acc.push(entry)
            return acc
          }, [])
          .filter(([key]) => {
            // MLX models only support context size setting
            if (provider.provider === 'mlx') {
              return key === 'ctx_len'
            }
            return true
          })
          .map(([key, value]) => {
            const config = value as ProviderSetting
            return (
              <div key={key} className="space-y-2">
                <div
                  className={cn(
                    'flex items-start justify-between gap-8',
                    (key === 'chat_template' ||
                      key === 'override_tensor_buffer_t' ||
                      config.controller_type === 'dropdown') &&
                      'flex-col gap-1 w-full'
                  )}
                >
                  <div className="mb-1 truncate">
                    <span title={config.title} className="font-medium">{config.title}</span>
                  </div>
                  <DynamicControllerSetting
                    key={config.key}
                    title={config.title}
                    description={config.description}
                    controllerType={config.controller_type}
                    controllerProps={{
                      ...config.controller_props,
                      value: config.controller_props?.value,
                    }}
                    onChange={(newValue) => handleSettingChange(key, newValue)}
                  />
                </div>
                <p className="text-muted-foreground leading-normal text-xs">
                  {config.description}
                </p>
              </div>
            )
          })
          })()}
        </div>
      </SheetContent>
    </Sheet>
  )
}

type MtpInfo = {
  mtp_layers: number
  mtp: boolean
  spec_draft_n_max?: number
  spec_draft_n_min?: number
  spec_draft_p_min?: number
}

function MtpPanel({
  modelId,
  provider,
}: {
  modelId: string
  provider: ProviderObject
}) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const [info, setInfo] = useState<MtpInfo | null>(null)

  useEffect(() => {
    let active = true
    serviceHub
      .models()
      .getMtpInfo(modelId)
      .then((v) => {
        if (active) setInfo(v)
      })
      .catch(() => {
        if (active) setInfo({ mtp_layers: 0, mtp: false })
      })
    return () => {
      active = false
    }
  }, [modelId, serviceHub])

  const versionBackend = provider.settings?.find(
    (s) => s.key === 'version_backend'
  )?.controller_props?.value as string | undefined
  const buildNo = parseBuildNumber(versionBackend?.split('/')[0])
  const backendSupports = buildNo !== null && buildNo >= MTP_MIN_BUILD

  const persist = useCallback(
    async (patch: {
      mtp?: boolean
      spec_draft_n_max?: number | null
      spec_draft_n_min?: number | null
      spec_draft_p_min?: number | null
    }) => {
      try {
        await serviceHub.models().updateMtpSettings(modelId, patch)
      } catch (e) {
        console.error('Failed to update MTP settings', e)
      }
    },
    [modelId, serviceHub]
  )

  if (!info || info.mtp_layers <= 0) return null

  const enabled = info.mtp === true && backendSupports

  const updateNumber = (
    key: 'spec_draft_n_max' | 'spec_draft_n_min' | 'spec_draft_p_min',
    raw: string
  ) => {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      setInfo({ ...info, [key]: undefined })
      void persist({ [key]: null })
      return
    }
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return
    setInfo({ ...info, [key]: n })
    void persist({ [key]: n })
  }

  return (
    <div className="space-y-3">
      <div className="font-medium">
        {t('common:modelSettings.mtp.section')}
      </div>

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-8">
          <div className="mb-1 truncate">
            <span className="font-medium">
              {t('common:modelSettings.mtp.enable')}
            </span>
          </div>
          <Switch
            checked={enabled}
            disabled={!backendSupports}
            onCheckedChange={(v) => {
              setInfo({ ...info, mtp: v })
              void persist({ mtp: v })
            }}
          />
        </div>
        <p className="text-muted-foreground leading-normal text-xs">
          {backendSupports
            ? t('common:modelSettings.mtp.enableDescription')
            : t('common:modelSettings.mtp.needsUpgrade')}
        </p>
      </div>

      {enabled && (
        <>
          <NumberRow
            label={t('common:modelSettings.mtp.nMax')}
            description={t('common:modelSettings.mtp.nMaxDescription')}
            placeholder="16"
            value={info.spec_draft_n_max}
            min={1}
            step={1}
            onChange={(raw) => updateNumber('spec_draft_n_max', raw)}
          />
          <NumberRow
            label={t('common:modelSettings.mtp.nMin')}
            description={t('common:modelSettings.mtp.nMinDescription')}
            placeholder="0"
            value={info.spec_draft_n_min}
            min={0}
            step={1}
            onChange={(raw) => updateNumber('spec_draft_n_min', raw)}
          />
          <NumberRow
            label={t('common:modelSettings.mtp.pMin')}
            description={t('common:modelSettings.mtp.pMinDescription')}
            placeholder="0.75"
            value={info.spec_draft_p_min}
            min={0}
            max={1}
            step={0.05}
            onChange={(raw) => updateNumber('spec_draft_p_min', raw)}
          />
        </>
      )}
    </div>
  )
}

function NumberRow({
  label,
  description,
  placeholder,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  description: string
  placeholder: string
  value: number | undefined
  min?: number
  max?: number
  step?: number
  onChange: (raw: string) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-8">
        <div className="mb-1 truncate">
          <span className="font-medium">{label}</span>
        </div>
        <Input
          type="number"
          className="w-32"
          placeholder={placeholder}
          value={value ?? ''}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <p className="text-muted-foreground leading-normal text-xs">
        {description}
      </p>
    </div>
  )
}
