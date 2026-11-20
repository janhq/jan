import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { SettingContribution, SettingValue } from '@janhq/extension-api'
import { CardItem } from '@/containers/Card'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { own, useContributions } from '@/lib/extensions/contributions'
import { getExtensionHost } from '@/lib/extensions/host'
import { useLocalize } from '@/lib/extensions/l10n'

type ControllerProps = Parameters<
  typeof DynamicControllerSetting
>[0]['controllerProps']

function controllerProps(
  setting: SettingContribution,
  value: SettingValue,
  text: (s: string) => string
): ControllerProps {
  const { control } = setting
  switch (control.type) {
    case 'input':
      return {
        value: value as string,
        placeholder:
          control.placeholder === undefined
            ? undefined
            : text(control.placeholder),
        type: setting.secret ? 'password' : control.inputType,
        input_actions: setting.secret ? ['unobscure'] : [],
      }
    case 'checkbox':
      return { value }
    case 'dropdown':
      return {
        value,
        options: control.options.map((o) => ({
          value: o.value,
          name: text(o.label),
        })),
      }
    case 'slider':
      return { value, min: control.min, max: control.max, step: control.step }
    case 'textarea':
      return { value, rows: control.rows }
  }
}

/**
 * The control returns numbers for numeric inputs, but every input setting
 * stores a string, so bring it back to the type the control declares.
 */
function toSettingValue(
  setting: SettingContribution,
  value: string | boolean | number
): SettingValue {
  const { type } = setting.control
  return type === 'input' || type === 'textarea' ? String(value) : value
}

function SettingRow({
  extensionId,
  setting,
}: {
  extensionId: string
  setting: SettingContribution
}) {
  const { t } = useTranslation()
  const localize = useLocalize()
  const extension = useContributions((s) => own(s.extensions, extensionId))
  const text = (s: string) => localize(extension, s)
  const title = text(setting.title)
  const [value, setValue] = useState<SettingValue>(setting.control.default)

  useEffect(() => {
    let cancelled = false
    getExtensionHost()
      .settings.getSettingValue(extensionId, setting.key)
      .then((stored) => {
        if (!cancelled && stored !== undefined) setValue(stored)
      })
      .catch((error) =>
        console.error(`Failed to read setting '${setting.key}':`, error)
      )
    return () => {
      cancelled = true
    }
  }, [extensionId, setting.key])

  const onChange = (raw: string | boolean | number) => {
    const next = toSettingValue(setting, raw)
    setValue(next)
    getExtensionHost()
      .settings.setSettingValue(extensionId, setting.key, next)
      .catch((error) => {
        console.error(`Failed to save setting '${setting.key}':`, error)
        toast.error(
          t('extensions:settingSaveFailed', { setting: title }),
          {
            description: error instanceof Error ? error.message : String(error),
          }
        )
      })
  }

  const column =
    setting.control.type === 'textarea' || setting.control.type === 'slider'
  return (
    <CardItem
      title={title}
      description={
        setting.description === undefined
          ? undefined
          : text(setting.description)
      }
      column={column}
      actions={
        <DynamicControllerSetting
          controllerType={setting.control.type}
          controllerProps={controllerProps(setting, value, text)}
          onChange={onChange}
        />
      }
    />
  )
}

/** The declared settings of one host extension, written through its settings store. */
export function ExtensionSettingsForm({
  extensionId,
  settings,
}: {
  extensionId: string
  settings: SettingContribution[]
}) {
  return settings.map((setting) => (
    <SettingRow key={setting.key} extensionId={extensionId} setting={setting} />
  ))
}
