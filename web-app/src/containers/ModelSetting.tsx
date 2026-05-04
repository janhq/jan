import { IconSettings } from '@tabler/icons-react'
import debounce from 'lodash.debounce'
import { ChevronsUpDown } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  const { updateProvider, providers } = useModelProvider()
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const setActiveModels = useAppState((state) => state.setActiveModels)

  // All non-embedding llamacpp models except the current one (candidates for draft model)
  const draftModelCandidates = providers
    .filter((p) => p.provider === 'llamacpp')
    .flatMap((p) => p.models)
    .filter(
      (m) =>
        m.id !== model.id &&
        !m.settings?.embedding?.controller_props?.value
    )

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
        key === 'n_cpu_moe' ||
        key === 'reasoning' ||
        key === 'draft_model_id' ||
        key === 'spec_type' ||
        key === 'draft_max' ||
        key === 'draft_min'
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
            if (entry[0] === 'reasoning') return acc
            if (entry[0] === 'ctx_len') {
              const autoIncrease = Object.entries(model.settings || {}).find(
                ([k]) => k === 'auto_increase_ctx_len'
              )
              if (autoIncrease) acc.push(autoIncrease)
            }
            acc.push(entry)
            return acc
          }, [])
          .reduce<[string, unknown][]>((acc, entry) => {
            const reasoning = Object.entries(model.settings || {}).find(
              ([k]) => k === 'reasoning'
            )
            if (reasoning && acc.length === 0) acc.push(reasoning)
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
          })}
        </div>

        {/* Speculative Decoding — only for llamacpp models */}
        {provider.provider === 'llamacpp' && (
          <div className="px-4 pb-6 space-y-4 border-t pt-6">
            <div>
              <h3 className="font-semibold text-sm">Speculative Decoding</h3>
              <p className="text-xs text-muted-foreground leading-normal mt-1">
                Use a smaller draft model or n-gram patterns to generate candidate tokens that the main model verifies in one batch, significantly increasing token throughput.
              </p>
            </div>

            {/* Draft Model */}
            <div className="space-y-1">
              <Label className="text-sm font-medium">Draft Model</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-between">
                    <span className="max-w-42 line-clamp-1">
                      {(model.settings?.draft_model_id?.controller_props?.value as string)
                        ? getModelDisplayName(
                            draftModelCandidates.find(
                              (m) => m.id === model.settings?.draft_model_id?.controller_props?.value
                            ) ?? { id: model.settings?.draft_model_id?.controller_props?.value as string }
                          )
                        : 'None (disabled)'}
                    </span>
                    <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-(--radix-dropdown-menu-trigger-width) max-h-70">
                  <DropdownMenuItem onClick={() => handleSettingChange('draft_model_id', '')}>
                    None (disabled)
                  </DropdownMenuItem>
                  {draftModelCandidates.map((m) => (
                    <DropdownMenuItem key={m.id} onClick={() => handleSettingChange('draft_model_id', m.id)}>
                      {getModelDisplayName(m)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <p className="text-xs text-muted-foreground leading-normal">
                A smaller model of the same architecture that generates draft tokens. Requires a compatible (same tokenizer) smaller model to be installed.
              </p>
            </div>

            {/* Spec Type (model-free) */}
            <div className="space-y-1">
              <Label className="text-sm font-medium">Spec Type</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-between">
                    <span className="max-w-42 line-clamp-1">
                      {(model.settings?.spec_type?.controller_props?.value as string) || 'none (disabled)'}
                    </span>
                    <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-(--radix-dropdown-menu-trigger-width) max-h-70">
                  {[
                    { value: 'none', label: 'none (disabled)' },
                    { value: 'ngram-simple', label: 'ngram-simple — simple n-gram pattern matching' },
                    { value: 'ngram-mod', label: 'ngram-mod — shared n-gram hash pool (good for reasoning models)' },
                    { value: 'ngram-cache', label: 'ngram-cache — n-gram cache lookup' },
                    { value: 'ngram-map-k', label: 'ngram-map-k — n-gram map with keys' },
                    { value: 'ngram-map-k4v', label: 'ngram-map-k4v — n-gram map with keys and values (experimental)' },
                  ].map((opt) => (
                    <DropdownMenuItem key={opt.value} onClick={() => handleSettingChange('spec_type', opt.value)}>
                      {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <p className="text-xs text-muted-foreground leading-normal">
                Model-free speculative decoding using token history patterns. Works without a draft model. Can be combined with a draft model.
              </p>
            </div>

            {/* Draft Max / Draft Min — shown when draft model or spec type is configured */}
            {((model.settings?.draft_model_id?.controller_props?.value &&
              model.settings.draft_model_id.controller_props.value !== '') ||
              (model.settings?.spec_type?.controller_props?.value &&
                model.settings.spec_type.controller_props.value !== 'none')) && (
              <div className="flex gap-4">
                <div className="flex-1 space-y-1">
                  <Label className="text-sm font-medium">Draft Max</Label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="16"
                    value={
                      (model.settings?.draft_max?.controller_props?.value as number) || ''
                    }
                    onChange={(e) =>
                      handleSettingChange(
                        'draft_max',
                        e.target.value === '' ? 0 : Number(e.target.value)
                      )
                    }
                    className="text-right"
                  />
                  <p className="text-xs text-muted-foreground">Max draft tokens per step (default: 16)</p>
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-sm font-medium">Draft Min</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={
                      (model.settings?.draft_min?.controller_props?.value as number) || ''
                    }
                    onChange={(e) =>
                      handleSettingChange(
                        'draft_min',
                        e.target.value === '' ? 0 : Number(e.target.value)
                      )
                    }
                    className="text-right"
                  />
                  <p className="text-xs text-muted-foreground">Min draft tokens required (default: 0)</p>
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
