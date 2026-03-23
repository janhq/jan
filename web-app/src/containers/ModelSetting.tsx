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
import { Input } from '@/components/ui/input'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { cn, getModelDisplayName } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAppState } from '@/hooks/useAppState'

/** Providers that run locally and already expose their own ctx_len in model.settings */
const LOCAL_PROVIDERS = new Set(['llamacpp', 'mlx'])

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

      // Keep selectedModel snapshot in sync so that the transport picks up the
      // new settings immediately without the user having to reselect the model.
      const currentState = useModelProvider.getState()
      if (currentState.selectedModel?.id === model.id) {
        useModelProvider.setState({ selectedModel: updatedModel as Model })
      }

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

  const isRemoteProvider = !LOCAL_PROVIDERS.has(provider.provider)

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

          {/* ── Token limits — shown for ALL providers ──────────────────── */}
          <div className="space-y-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Token Limits
            </p>

            {/* Max Context Tokens — remote only; local models use the
                predefined "Context Size" field in their model.settings */}
            {isRemoteProvider && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium">Max Context Tokens</span>
                  <Input
                    type="number"
                    min={0}
                    step={512}
                    placeholder="e.g. 8192"
                    className="w-28 text-right"
                    value={(model.settings?.ctx_len?.controller_props?.value as string | number) ?? ''}
                    onChange={(e) =>
                      handleSettingChange(
                        'ctx_len',
                        e.target.value === '' ? '' : Number(e.target.value)
                      )
                    }
                  />
                </div>
                <p className="text-xs text-muted-foreground leading-normal">
                  Total context window (input + output). Older messages are
                  automatically trimmed to keep the conversation within this
                  limit.
                </p>
              </div>
            )}

            {/* Max Output Tokens — shown for ALL providers */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium">Max Output Tokens</span>
                <Input
                  type="number"
                  min={0}
                  step={256}
                  placeholder="e.g. 4096"
                  className="w-28 text-right"
                  value={
                    (model.settings?.max_output_tokens?.controller_props
                      ?.value as string | number) ?? ''
                  }
                  onChange={(e) =>
                    handleSettingChange(
                      'max_output_tokens',
                      e.target.value === '' ? '' : Number(e.target.value)
                    )
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground leading-normal">
                Maximum tokens the model may generate per reply. Sent as{' '}
                <code className="text-xs">max_tokens</code> in API requests.
                Leave blank to use the provider default.
              </p>
            </div>

            {Object.keys(model.settings || {}).length > 0 && (
              <div className="border-t pt-2" />
            )}
          </div>

          {/* ── Existing model.settings entries (local & remote) ─────────── */}
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
            // max_output_tokens is always rendered in the "Token Limits"
            // section above, so never render it again in the dynamic list.
            if (key === 'max_output_tokens') return false
            // ctx_len for remote providers is also in the Token Limits section.
            if (isRemoteProvider && key === 'ctx_len') return false
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
