import { IconSettings, IconLoader } from '@tabler/icons-react'
import debounce from 'lodash.debounce'
import { useState } from 'react'

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
<<<<<<< HEAD
  smallIcon?: boolean
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
}

export function ModelSetting({
  model,
  provider,
<<<<<<< HEAD
  smallIcon,
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
}: ModelSettingProps) {
  const { updateProvider } = useModelProvider()
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const setActiveModels = useAppState((state) => state.setActiveModels)

  const [isPlanning, setIsPlanning] = useState(false)

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

  const handlePlanModelLoad = async () => {
    if (provider.provider !== 'llamacpp') {
      console.warn('planModelLoad is only available for llamacpp provider')
      return
    }
    setIsPlanning(true)
    try {
      // Read the model config to get the actual model path and mmproj path
      const modelConfig = await serviceHub.app().readYaml<{
        model_path: string
        mmproj_path?: string
      }>(`llamacpp/models/${model.id}/model.yml`)

      if (modelConfig && modelConfig.model_path) {
        const result = await serviceHub
          .models()
          .planModelLoad(modelConfig.model_path, modelConfig.mmproj_path)

        // Apply the recommended settings to the model sequentially to avoid race conditions
        const settingsToUpdate: Array<{
          key: string
          value: number | boolean
        }> = []

        if (model.settings?.ngl && result.gpuLayers !== undefined) {
          settingsToUpdate.push({ key: 'ngl', value: result.gpuLayers })
        }

        if (model.settings?.ctx_len && result.maxContextLength !== undefined) {
          settingsToUpdate.push({
            key: 'ctx_len',
            value: result.maxContextLength,
          })
        }

        if (
          model.settings?.no_kv_offload &&
          result.noOffloadKVCache !== undefined
        ) {
          settingsToUpdate.push({
            key: 'no_kv_offload',
            value: result.noOffloadKVCache,
          })
        }
        if (
          model.settings?.no_kv_offload &&
          result.noOffloadKVCache !== undefined
        ) {
          settingsToUpdate.push({
            key: 'no_kv_offload',
            value: result.noOffloadKVCache,
          })
        }

        if (
          model.settings?.mmproj_offload &&
          result.offloadMmproj !== undefined
        ) {
          settingsToUpdate.push({
            key: 'mmproj_offload',
            value: result.offloadMmproj,
          })
        }

        if (model.settings?.batch_size && result.batchSize !== undefined) {
          settingsToUpdate.push({
            key: 'batch_size',
            value: result.batchSize,
          })
        }

        // Apply all settings in a single update to avoid race conditions
        if (settingsToUpdate.length > 0) {
          handleMultipleSettingsChange(settingsToUpdate)
        }
      } else {
        console.warn('No model_path found in config for', model.id)
      }
    } catch (error) {
      console.error('Error calling planModelLoad:', error)
    } finally {
      setIsPlanning(false)
    }
  }

  const handleMultipleSettingsChange = (
    settingsToUpdate: Array<{ key: string; value: number | boolean }>
  ) => {
    if (!provider) return

    // Create a copy of the model with ALL updated settings at once
    let updatedModel = { ...model }

    settingsToUpdate.forEach(({ key, value }) => {
      const existingSetting = updatedModel.settings?.[key] as ProviderSetting
      updatedModel = {
        ...updatedModel,
        settings: {
          ...updatedModel.settings,
          [key]: {
            ...existingSetting,
            controller_props: {
              ...existingSetting?.controller_props,
              value: value,
            },
          } as ProviderSetting,
        },
      }
    })

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

      // Check if any of the updated settings require a model restart
      const requiresRestart = settingsToUpdate.some(
        ({ key }) =>
          key === 'ctx_len' ||
          key === 'ngl' ||
          key === 'chat_template' ||
          key === 'offload_mmproj' ||
          key === 'batch_size' ||
          key === 'cpu_moe' ||
          key === 'n_cpu_moe'
      )

      if (requiresRestart) {
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

  return (
    <Sheet>
      <SheetTrigger asChild>
<<<<<<< HEAD
        <div
          className={cn(
            'size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out',
            smallIcon && 'size-5'
          )}
        >
          <IconSettings size={18} className="text-main-view-fg/50" />
        </div>
      </SheetTrigger>
      <SheetContent className="h-[calc(100%-8px)] top-1 right-1 rounded-e-md overflow-y-auto">
=======
        <Button variant="ghost" size="icon-xs">
          <IconSettings size={18} className="text-muted-foreground" />
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        <SheetHeader>
          <SheetTitle>
            {t('common:modelSettings.title', {
              modelId: getModelDisplayName(model),
            })}
          </SheetTitle>
<<<<<<< HEAD
          <SheetDescription>
=======
          <SheetDescription className='text-xs leading-normal'>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            {t('common:modelSettings.description')}
          </SheetDescription>

          {/* Model Load Planning Section - Only show for llamacpp provider */}
          {provider.provider === 'llamacpp' && (
<<<<<<< HEAD
            <div className="pb-4 border-b border-main-view-fg/10 my-4">
=======
            <div className="pb-4 border-b mt-4">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
              <div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium">Optimize Settings</h3>
<<<<<<< HEAD
                    <div className="text-xs bg-main-view-fg/10 border border-main-view-fg/20 text-main-view-fg/70 rounded-full py-0.5 px-2">
                      <span>{t('mcp-servers:experimental')}</span>
                    </div>
                  </div>
                  <p className="text-main-view-fg/70 text-xs mb-3">
=======
                    <div className="text-xs bg-secondary border text-muted-foreground rounded-full py-0.5 px-2">
                      <span>{t('mcp-servers:experimental')}</span>
                    </div>
                  </div>
                  <p className="text-muted-foreground leading-normal text-xs mb-3">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                    Analyze your system and model, then apply optimal loading
                    settings automatically
                  </p>
                </div>
                <Button
                  onClick={handlePlanModelLoad}
                  disabled={isPlanning}
                  variant="default"
                  className="w-full"
                >
                  {isPlanning ? (
                    <>
                      <IconLoader size={16} className="mr-2 animate-spin" />
                      Optimizing...
                    </>
                  ) : (
                    <>Auto-Optimize Settings</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </SheetHeader>

<<<<<<< HEAD
        <div className="px-4 space-y-6">
          {Object.entries(model.settings || {}).map(([key, value]) => {
            const config = value as ProviderSetting

=======
        <div className="px-4 space-y-8 pb-4">
          {Object.entries(model.settings || {}).map(([key, value]) => {
            const config = value as ProviderSetting
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            return (
              <div key={key} className="space-y-2">
                <div
                  className={cn(
<<<<<<< HEAD
                    'flex items-start justify-between gap-8 last:mb-2',
=======
                    'flex items-start justify-between gap-8',
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                    (key === 'chat_template' ||
                      key === 'override_tensor_buffer_t') &&
                      'flex-col gap-1 w-full'
                  )}
                >
<<<<<<< HEAD
                  <div className="space-y-1 mb-2">
                    <h3 className="font-medium">{config.title}</h3>
                    <p className="text-main-view-fg/70 text-xs">
                      {config.description}
                    </p>
=======
                  <div className="mb-1 truncate">
                    <span title={config.title} className="font-medium">{config.title}</span>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
=======
                <p className="text-muted-foreground leading-normal text-xs">
                  {config.description}
                </p>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
              </div>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
