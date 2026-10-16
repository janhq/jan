import { IconSettings } from '@tabler/icons-react'
import debounce from 'lodash.debounce'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type SpecConfig,
  type SpecConfigKey,
  type SpecConfigPatch,
  type SpecTypeParameter,
  isSpecType,
  isSpecDraftType,
  specTypeParameters,
} from '@janhq/core'

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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { SamplerDefaults } from '@/containers/SamplerDefaults'
import { ChatTemplateKwargs } from '@/containers/ChatTemplateKwargs'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { cn, getModelDisplayName } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAppState } from '@/hooks/useAppState'
import { paramsSettings, samplerKeysForProvider } from '@/lib/predefinedParams'

type ModelSettingProps = {
  provider: ProviderObject
  model: Model
}

/**
 * Shared model-settings form + persistence, driven by both the header Sheet
 * (ModelSetting) and the Cowork right rail (CoworkModelPanel). Keeping the
 * handlers here avoids two copies of the debounced yaml-write / router-restart
 * logic diverging.
 */
function useModelSettingControls(model: Model, provider: ProviderObject) {
  const { updateProvider } = useModelProvider()
  const serviceHub = useServiceHub()
  const setActiveModels = useAppState((state) => state.setActiveModels)

  // Debounced stopModel — memoized so the timer survives across renders.
  // Without useMemo a fresh debounce is created every keystroke and the
  // cleanup effect below cancels the previous timer before it can fire.
  const debouncedStopModel = useMemo(
    () =>
      debounce((modelId: string) => {
        serviceHub
          .models()
          .stopModel(modelId)
          .then(() => {
            serviceHub
              .models()
              .getActiveModels()
              .then((models) => setActiveModels(models || []))
          })
      }, 500),
    [serviceHub, setActiveModels]
  )

  // Coalesce rapid sidebar edits into a single yaml-write + router-restart.
  // Each call merges into a per-model accumulator; the debounced flush writes
  // and clears it. Avoids a flurry of slider drags rewriting model.yml + bouncing
  // the router on every keystroke.
  const pendingPatchesRef = useRef<
    Map<string, Record<string, string | number | boolean | null | undefined>>
  >(new Map())
  const rollbackSettingsRef = useRef<
    Map<string, Model['settings'] | undefined>
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
            .then(() => {
              rollbackSettingsRef.current.delete(modelId)
            })
            .catch((e) => {
              const previousSettings = rollbackSettingsRef.current.get(modelId)
              rollbackSettingsRef.current.delete(modelId)
              const latestProvider = useModelProvider
                .getState()
                .getProviderByName(provider.provider)
              if (latestProvider) {
                const modelIndex = latestProvider.models.findIndex(
                  (m) => m.id === modelId
                )
                if (modelIndex !== -1) {
                  const revertedModels = [...latestProvider.models]
                  revertedModels[modelIndex] = {
                    ...revertedModels[modelIndex],
                    settings: previousSettings,
                  } as Model
                  useModelProvider
                    .getState()
                    .updateProvider(provider.provider, {
                      models: revertedModels,
                    })
                }
              }
              console.error('Failed to persist model settings', e)
            })
        }
      }, 1500),
    [provider.provider, serviceHub]
  )
  const debouncedPersistModelSettings = (
    modelId: string,
    patch: Record<string, string | number | boolean | null | undefined>,
    previousSettings: Model['settings'] | undefined
  ) => {
    if (!rollbackSettingsRef.current.has(modelId)) {
      rollbackSettingsRef.current.set(modelId, previousSettings)
    }
    const existing = pendingPatchesRef.current.get(modelId) ?? {}
    pendingPatchesRef.current.set(modelId, { ...existing, ...patch })
    flushPendingPatches()
  }

  useEffect(() => {
    return () => {
      // Flush — not cancel — so a pending ctx_len/ngl edit still gets
      // written to model.yml and the router restarted after the sheet closes.
      flushPendingPatches.flush()
      debouncedStopModel.flush()
    }
  }, [debouncedStopModel, flushPendingPatches])

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
        key === 'n_cpu_moe' ||
        key === 'n_cpu_ffn'
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
        debouncedPersistModelSettings(
          model.id,
          { [key]: value },
          model.settings
        )
      }
    }
  }

  // Chat-template kwargs are a per-request concern (sent as chat_template_kwargs),
  // not a router preset arg — persist to the store only, like `reasoning`.
  const handleTemplateKwargsChange = (
    value: Record<string, boolean | number | string>
  ) => {
    if (!provider) return
    const modelIndex = provider.models.findIndex((m) => m.id === model.id)
    if (modelIndex === -1) return
    const existing = model.settings?.chat_template_kwargs
    const updatedModel = {
      ...model,
      settings: {
        ...model.settings,
        chat_template_kwargs: {
          key: 'chat_template_kwargs',
          title: 'Chat template options',
          description: '',
          controller_type: 'object',
          ...(existing ?? {}),
          controller_props: {
            ...(existing?.controller_props ?? {}),
            value,
          },
        },
      },
    } as unknown as Model
    const updatedModels = [...provider.models]
    updatedModels[modelIndex] = updatedModel
    updateProvider(provider.provider, { models: updatedModels })
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

  return {
    handleSettingChange,
    handleTemplateKwargsChange,
    handleEngineSettingChange,
    fitEnabled,
    fitCtxSetting,
  }
}

/** The settings body, shared by the header Sheet and the Cowork rail. */
export function ModelSettingFields({ model, provider }: ModelSettingProps) {
  const { t } = useTranslation()
  const {
    handleSettingChange,
    handleTemplateKwargsChange,
    handleEngineSettingChange,
    fitEnabled,
    fitCtxSetting,
  } = useModelSettingControls(model, provider)

  return (
    <div className="px-4 space-y-8 pb-4 flex-1 min-h-0 overflow-y-auto">
      {provider.provider === 'llamacpp' && (
        <SpecDecodingPanel modelId={model.id} />
      )}
      {provider.provider === 'llamacpp' && model.embedding !== true && (
        <ChatTemplateKwargs
          model={model}
          onChange={handleTemplateKwargsChange}
        />
      )}
      {(provider.provider === 'llamacpp' || provider.provider === 'mlx') &&
        model.embedding !== true && (
          <SamplerDefaults
            model={model}
            keys={samplerKeysForProvider(provider.provider)}
            onChange={handleSettingChange}
          />
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
            if (entry[0] === 'reasoning') return acc
            // Rendered by the dedicated ChatTemplateKwargs section above.
            if (entry[0] === 'chat_template_kwargs') return acc
            // Removed in v15 migration; defend against any pre-migration
            // localStorage state that still carries the orphan entry.
            if (entry[0] === 'auto_increase_ctx_len') return acc
            if (fitEnabled && entry[0] === 'ctx_len') return acc
            // Sampling params live in the composer popover, not the sidebar.
            if (entry[0] in paramsSettings) return acc
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
                    <span title={config.title} className="font-medium">
                      {config.title}
                    </span>
                  </div>
                  <DynamicControllerSetting
                    key={config.key}
                    title={config.title}
                    description={config.description}
                    controllerType={config.controller_type}
                    disabledReason={
                      fitEnabled && key === 'ngl'
                        ? t('common:modelSettings.nglDisabledByFit')
                        : undefined
                    }
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
  )
}

export function ModelSetting({ model, provider }: ModelSettingProps) {
  const { t } = useTranslation()
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-xs">
          <IconSettings size={18} className="text-muted-foreground" />
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            {t('common:modelSettings.title', {
              modelId: getModelDisplayName(model),
            })}
          </SheetTitle>
          <SheetDescription className="text-xs leading-normal">
            {t('common:modelSettings.description')}
          </SheetDescription>
        </SheetHeader>
        <ModelSettingFields model={model} provider={provider} />
      </SheetContent>
    </Sheet>
  )
}

export function SpecDecodingPanel({ modelId }: { modelId: string }) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const [info, setInfo] = useState<SpecConfigPatch | null>(null)

  useEffect(() => {
    let active = true
    serviceHub
      .models()
      .getSpecDecodingSettings(modelId)
      .then((v) => {
        if (active) setInfo(v)
      })
      .catch(() => {
        if (active) setInfo({ mtp_layers: 0 })
      })
    return () => {
      active = false
    }
  }, [modelId, serviceHub])

  const persist = useCallback(
    async (patch: {
      [K in SpecConfigKey]?: SpecConfig[K] | null
    }) => {
      try {
        await serviceHub.models().updateSpecDecodingSettings(modelId, patch)
      } catch (e) {
        console.error('Failed to update speculative decoding settings', e)
      }
    },
    [modelId, serviceHub]
  )

  if (!info) return null
  const enabled = !!isSpecType(info.spec_type)

  const specOptions = [
    ...(isSpecDraftType(info.spec_draft_type)
      ? [{ id: info.spec_draft_type }]
      : []),
    { id: 'ngram-simple' },
    { id: 'ngram-cache' },
    { id: 'ngram-map-k' },
    { id: 'ngram-map-k4v' },
    { id: 'ngram-mod' },
  ].map((item) => ({
    ...item,
    label: t(`common:modelSettings.specSettings.${item.id}`),
    description: t(`common:modelSettings.specSettings.${item.id}Description`),
  }))

  const parameters =
    specTypeParameters[info.spec_type as keyof typeof specTypeParameters] ?? []

  const sliderParameters = parameters.filter(
    (
      param
    ): param is SpecTypeParameter & {
      step: number
      min: number
      max: number
    } =>
      param.step !== undefined &&
      param.min !== undefined &&
      param.max !== undefined
  )

  const numberParameters = parameters.filter(
    (
      param
    ): param is SpecTypeParameter & {
      step: number
      min: number
    } =>
      param.step !== undefined &&
      param.min !== undefined &&
      param.max === undefined
  )

  const fileParameters = parameters.filter((param) => param.min === undefined)

  const handleFileSelect = async (key: SpecConfigKey) => {
    const selectedFile = await serviceHub.dialog().open({
      multiple: false,
      directory: false,
    })
    if (selectedFile && typeof selectedFile === 'string') {
      setInfo({ ...info, [key]: selectedFile })
      void persist({ [key]: selectedFile })
    }
  }

  return (
    <div className="space-y-3">
      <div className="font-medium">
        {t('common:modelSettings.specSettings.section')}
      </div>

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-8">
          <div className="mb-1 truncate">
            <span className="font-medium">
              {t('common:modelSettings.specSettings.enable')}
            </span>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => {
              let newSpecType = null
              if (v) {
                if (info.spec_draft_type !== undefined) {
                  newSpecType = info.spec_draft_type
                } else {
                  newSpecType = 'ngram-simple'
                }
              }
              setInfo({ ...info, spec_type: newSpecType })
              void persist({ spec_type: newSpecType })
            }}
          />
        </div>
        <p className="text-muted-foreground leading-normal text-xs">
          {t('common:modelSettings.specSettings.enableDescription')}
        </p>
      </div>

      {info.spec_type && (
        <div className="space-y-4 pt-2">
          <div className="space-y-4 pt-2">
            <RadioGroup
              value={info.spec_type.toString()}
              onValueChange={(value) => {
                setInfo({ ...info, spec_type: value })
                void persist({ spec_type: value })
              }}
              className="grid grid-cols-1 gap-2"
            >
              {specOptions.map((item) => (
                <label
                  key={item.id}
                  htmlFor={`spec-type-${item.id}`}
                  className="flex cursor-pointer items-center space-x-3 rounded-md p-2 text-sm hover:bg-accent"
                >
                  <RadioGroupItem id={`spec-type-${item.id}`} value={item.id} />
                  <div className="flex flex-col">
                    <span>{item.label}</span>
                    {item.description && (
                      <span className="text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </RadioGroup>
          </div>
          {numberParameters.map((numberRow) => (
            <SettingRow
              {...numberRow}
              controllerType="input"
              value={
                info[numberRow.key] === undefined
                  ? Number(numberRow.default)
                  : Number(info[numberRow.key])
              }
              onChange={(value) => {
                setInfo({
                  ...info,
                  [numberRow.key]:
                    value === undefined ? numberRow.default : value,
                })

                void persist({
                  [numberRow.key]:
                    value === numberRow.default
                      ? null
                      : Number(
                          Math.floor(value / numberRow.step) * numberRow.step
                        ),
                })
              }}
            />
          ))}
          {sliderParameters.map((sliderRow) => (
            <SettingRow
              {...sliderRow}
              controllerType="slider"
              value={
                info[sliderRow.key] === undefined
                  ? Number(sliderRow.default)
                  : Number(info[sliderRow.key])
              }
              onChange={(value) => {
                setInfo({
                  ...info,
                  [sliderRow.key]:
                    value === undefined ? sliderRow.default : value,
                })

                void persist({
                  [sliderRow.key]:
                    value === sliderRow.default
                      ? null
                      : Number(
                          Math.floor(value / sliderRow.step) * sliderRow.step
                        ),
                })
              }}
            />
          ))}
          {fileParameters.map((fileSelectRow) => (
            <FileSelectRow
              {...fileSelectRow}
              value={
                typeof info[fileSelectRow.key] === 'string'
                  ? String(info[fileSelectRow.key])
                  : ''
              }
              onClick={() => handleFileSelect(fileSelectRow.key)}
              onChange={(value) => {
                const newValue = value === '' ? null : String(value)
                setInfo({
                  ...info,
                  [fileSelectRow.key]: newValue,
                })

                void persist({
                  [fileSelectRow.key]: newValue,
                })
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SettingRow({
  controllerType,
  key,
  translationPath,
  value,
  min,
  max,
  step,
  onChange,
}: SpecTypeParameter & {
  controllerType: string
  value: number
  onChange: (value: number) => void
}) {
  const { t } = useTranslation()
  const title = t(`common:modelSettings.specSettings.${translationPath}`)
  const description = t(
    `common:modelSettings.specSettings.${translationPath}Description`
  )
  return (
    <div className="sliderRow space-y-2">
      <div className="flex items-start justify-between flex-col gap-1 w-full">
        <div className="mb-1 truncate">
          <span title={title} className="font-medium">
            {title}
          </span>
        </div>

        <DynamicControllerSetting
          key={key}
          title={title}
          description={description}
          controllerType={controllerType}
          controllerProps={{
            value,
            step,
            min,
            max,
          }}
          onChange={(value) => onChange(Number(value))}
        />
      </div>

      <p className="text-muted-foreground leading-normal text-xs">
        {description}
      </p>
    </div>
  )
}

function FileSelectRow({
  translationPath,
  value,
  onClick,
  onChange,
}: {
  translationPath: string
  value: string
  onClick: () => void
  onChange: (newValue: string) => void
}) {
  const { t } = useTranslation()
  const title = t(`common:modelSettings.specSettings.${translationPath}`)
  const description = t(
    `common:modelSettings.specSettings.${translationPath}Description`
  )
  return (
    <div className="w-full">
      <div className="mb-1 truncate">
        <span title={title} className="font-medium">
          {title}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <Input
            value={value !== undefined ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="File path"
          />
          <Button variant="outline" size="sm" onClick={() => onClick()}>
            Select
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground leading-normal text-xs">
        {description}
      </p>
    </div>
  )
}
