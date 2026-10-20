import { useState } from 'react'
import { IconPlus, IconTrash } from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n/react-i18next-compat'

type KwargValue = boolean | number | string
type KwargBag = Record<string, KwargValue>

function coerceRawValue(raw: string): KwargValue {
  const trimmed = raw.trim()
  if (trimmed === 'true' || trimmed === 'false') return trimmed === 'true'
  const n = Number(trimmed)
  if (trimmed.length > 0 && Number.isFinite(n)) return n
  return raw
}

function readBag(model: Model): KwargBag {
  const raw: unknown =
    model.settings?.chat_template_kwargs?.controller_props?.value
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return { ...(raw as KwargBag) }
}

export function ChatTemplateKwargs({
  model,
  onChange,
}: {
  model: Model
  onChange: (value: KwargBag) => void
}) {
  const { t } = useTranslation()
  const detected = model.template_kwargs ?? []
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  if (detected.length === 0) return null

  const bag = readBag(model)
  const detectedNames = new Set(detected.map((k) => k.name))
  const customEntries = Object.entries(bag).filter(([k]) => !detectedNames.has(k))

  const setValue = (name: string, value: KwargValue) => {
    onChange({ ...bag, [name]: value })
  }
  const removeValue = (name: string) => {
    const next = { ...bag }
    delete next[name]
    onChange(next)
  }
  const addCustom = () => {
    const key = newKey.trim()
    if (!key || key in bag || detectedNames.has(key)) return
    onChange({ ...bag, [key]: coerceRawValue(newValue) })
    setNewKey('')
    setNewValue('')
    setAdding(false)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="font-medium">
          {t('common:modelSettings.templateKwargs.section')}
        </div>
        <p className="text-muted-foreground leading-normal text-xs">
          {t('common:modelSettings.templateKwargs.description')}
        </p>
      </div>

      {detected.map((kwarg) => {
        const current = bag[kwarg.name] ?? kwarg.default
        return (
          <div
            key={kwarg.name}
            className="flex items-center justify-between gap-8"
          >
            <span className="font-medium truncate" title={kwarg.name}>
              {kwarg.name}
            </span>
            {kwarg.type === 'boolean' ? (
              <Switch
                checked={current === true}
                onCheckedChange={(v) => setValue(kwarg.name, v)}
              />
            ) : (
              <Input
                type={kwarg.type === 'number' ? 'number' : 'text'}
                className="w-40"
                value={String(current)}
                onChange={(e) =>
                  setValue(
                    kwarg.name,
                    kwarg.type === 'number'
                      ? Number(e.target.value)
                      : e.target.value
                  )
                }
              />
            )}
          </div>
        )
      })}

      {customEntries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-2">
          <span className="font-medium truncate flex-1" title={key}>
            {key}
          </span>
          <Input
            className="w-40"
            value={String(value)}
            onChange={(e) => setValue(key, coerceRawValue(e.target.value))}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => removeValue(key)}
            title={t('common:modelSettings.templateKwargs.remove')}
          >
            <IconTrash size={16} className="text-muted-foreground" />
          </Button>
        </div>
      ))}

      {adding ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              placeholder={t(
                'common:modelSettings.templateKwargs.keyPlaceholder'
              )}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
            <Input
              className="flex-1"
              placeholder={t(
                'common:modelSettings.templateKwargs.valuePlaceholder'
              )}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="link" size="sm" onClick={addCustom}>
              {t('common:modelSettings.templateKwargs.add')}
            </Button>
            <Button
              variant="link"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                setAdding(false)
                setNewKey('')
                setNewValue('')
              }}
            >
              {t('common:modelSettings.templateKwargs.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="link"
          size="sm"
          className="px-0"
          onClick={() => setAdding(true)}
        >
          <IconPlus size={14} className="mr-1" />
          {t('common:modelSettings.templateKwargs.addCustom')}
        </Button>
      )}
    </div>
  )
}
