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
import { syncActiveModelsFromEngines } from '@/utils/activeModelsSync'

type ModelSettingProps = {
  provider: ProviderObject
  model: Model
}

// Sampling parameters are edited globally in the Sampling popover; their
// legacy load-time twins under `model.settings.*` are hidden from this gear
// to avoid two competing sources of truth. Data on disk is preserved.
const LEGACY_SAMPLING_KEYS = new Set<string>([
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'repeat_penalty',
  'repeat_last_n',
  'presence_penalty',
  'frequency_penalty',
])

export function ModelSetting({
  model,
  provider,
}: ModelSettingProps) {
  const { updateProvider } = useModelProvider()
  const { t } = useTranslation()
  const serviceHub = useServiceHub()

  // Create a debounced version that stops and restarts the model with updated settings
  const debouncedRestartModel = debounce(async (modelId: string, providerName: string) => {
    try {
      await serviceHub.models().stopModel(modelId)

      const freshProvider = useModelProvider.getState().getProviderByName(providerName)
      if (freshProvider) {
        await serviceHub.models().startModel(freshProvider, modelId, true)
      }

      const models = await serviceHub.models().getActiveModels()
      // Preserve any active cloud model from the UI state so the restart
      // of a local model's settings doesn't clear it.
      syncActiveModelsFromEngines(models || [])
    } catch (error) {
      console.error('Failed to restart model after settings change:', error)
    }
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

      // Call debounced stopModel only when updating ctx_len, ngl, chat_template, or offload_mmproj
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
        // Check if model is running before restarting it with new settings
        serviceHub
          .models()
          .getActiveModels()
          .then((activeModels) => {
            if (activeModels.includes(model.id)) {
              debouncedRestartModel(model.id, provider.provider)
            }
          })
      }
    }
  }

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
          {Object.entries(model.settings || {})
          .reduce<[string, unknown][]>((acc, entry) => {
            if (entry[0] === 'auto_increase_ctx_len') return acc
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
            // Sampling now lives solely in the global Sampling popover
            // (model bar). Hide the legacy load-time sampling controls here
            // so there is exactly one place to tune sampling. The persisted
            // `model.settings.*` values are left untouched on disk.
            if (LEGACY_SAMPLING_KEYS.has(key)) return false
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
                      key === 'override_tensor_buffer_t') &&
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
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
