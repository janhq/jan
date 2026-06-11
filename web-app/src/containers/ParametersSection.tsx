import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  paramCategories,
  paramGroups,
  paramsSettings,
  SAMPLING_PARAM_KEYS,
  type ParamSetting,
} from '@/lib/predefinedParams'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

interface ParametersSectionProps {
  parameters: Record<string, unknown>
  onChange: (key: string, value: number | boolean) => void
  /** Subset/order of param keys to render. Defaults to all sampling keys. */
  paramKeys?: string[]
  className?: string
}

function readNumber(
  parameters: Record<string, unknown>,
  setting: ParamSetting
): number {
  const raw = parameters[setting.key]
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw)))
    return Number(raw)
  return setting.value as number
}

function readBoolean(
  parameters: Record<string, unknown>,
  setting: ParamSetting
): boolean {
  const raw = parameters[setting.key]
  if (typeof raw === 'boolean') return raw
  return setting.value as boolean
}

function clamp(value: number, min?: number, max?: number): number {
  let next = value
  if (typeof min === 'number') next = Math.max(min, next)
  if (typeof max === 'number') next = Math.min(max, next)
  return next
}

export function ParametersSection({
  parameters,
  onChange,
  paramKeys = SAMPLING_PARAM_KEYS,
  className,
}: ParametersSectionProps) {
  const { t } = useTranslation()
  const visible = new Set(paramKeys)

  return (
    <div className={cn('space-y-2.5', className)}>
      {paramCategories.map((category) => {
        const keys = paramGroups[category.id].filter((key) => visible.has(key))
        if (keys.length === 0) return null

        return (
          <div key={category.id} className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide">
              {t(`assistants:paramCategory.${category.id}`)}
            </div>

            {keys.map((key) => {
              const setting = paramsSettings[key]
              if (!setting) return null

              if (setting.controllerType === 'checkbox') {
                const checked = readBoolean(parameters, setting)
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-4"
                  >
                    <span
                      className="text-sm text-muted-foreground truncate"
                      title={setting.description}
                    >
                      {setting.title}
                    </span>
                    <Switch
                      checked={checked}
                      onCheckedChange={(value) => onChange(key, value)}
                    />
                  </div>
                )
              }

              const value = readNumber(parameters, setting)
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className="text-sm text-muted-foreground truncate"
                      title={setting.description}
                    >
                      {setting.title}
                    </span>
                    <Input
                      type="number"
                      value={value}
                      min={setting.min}
                      max={setting.max}
                      step={setting.step ?? 'any'}
                      onChange={(e) => {
                        const parsed = Number(e.target.value)
                        if (Number.isNaN(parsed)) return
                        onChange(key, clamp(parsed, setting.min, setting.max))
                      }}
                      className="h-6 w-14 rounded-md border-0 bg-transparent px-1 text-right text-xs text-muted-foreground/80 tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent"
                    />
                  </div>
                  {setting.controllerType === 'slider' && (
                    <Slider
                      value={[value]}
                      min={setting.min ?? 0}
                      max={setting.max ?? 1}
                      step={setting.step ?? 0.01}
                      onValueChange={(values) => onChange(key, values[0])}
                      className="[&_[data-slot=slider-track]]:bg-muted [&_[data-slot=slider-range]]:bg-muted-foreground/40 [&_[data-slot=slider-thumb]]:border-muted-foreground/40 [&_[data-slot=slider-thumb]]:bg-muted-foreground"
                    />
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
