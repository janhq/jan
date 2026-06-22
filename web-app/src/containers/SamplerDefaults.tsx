import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  paramsSettings,
  resolveSamplerValue,
  SAMPLER_DEFAULT_KEYS,
} from '@/lib/predefinedParams'

type SamplerDefaultsProps = {
  model: Model
  /** Sampler keys to render; defaults to the full set. */
  keys?: readonly string[]
  /** Draft overrides (dialogs that persist on save); falls back to model.settings. */
  pendingValues?: Record<string, string | number | boolean>
  onChange: (key: string, value: string | number | boolean) => void
}

export function SamplerDefaults({
  model,
  keys = SAMPLER_DEFAULT_KEYS,
  pendingValues,
  onChange,
}: SamplerDefaultsProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <div>
        <span className="font-medium">
          {t('common:modelSettings.samplingDefaults.title')}
        </span>
        <p className="text-muted-foreground leading-normal text-xs">
          {t('common:modelSettings.samplingDefaults.description')}
        </p>
      </div>
      {keys.map((key) => {
        const def = paramsSettings[key]
        if (!def) return null
        const value =
          pendingValues && key in pendingValues
            ? pendingValues[key]
            : resolveSamplerValue(
                model.settings?.[key]?.controller_props?.value,
                def.value
              )
        return (
          <div key={key} className="space-y-2">
            <div className="flex items-start justify-between gap-8">
              <div className="mb-1 truncate">
                <span title={def.title} className="font-medium">
                  {def.title}
                </span>
              </div>
              <DynamicControllerSetting
                title={def.title}
                description={def.description}
                controllerType={def.controllerType}
                controllerProps={{ ...(def.controllerProps ?? {}), value }}
                onChange={(newValue) => onChange(key, newValue)}
              />
            </div>
            <p className="text-muted-foreground leading-normal text-xs">
              {def.description}
            </p>
          </div>
        )
      })}
    </div>
  )
}
