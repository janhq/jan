import { IconSettings } from '@tabler/icons-react'
import debounce from 'lodash.debounce'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { cn, getModelDisplayName } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAppState } from '@/hooks/useAppState'

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
