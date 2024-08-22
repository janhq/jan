import { useEffect, useState } from 'react'

import { SettingComponentProps } from '@janhq/core'
import { Button } from '@janhq/joi'

import SettingDetailTextInputItem from '../SettingDetailTextInputItem'
import SettingDetailToggleItem from '../SettingDetailToggleItem'

type Props = {
  settingProps: SettingComponentProps
  onValueChanged: (updatedSettingProps: SettingComponentProps) => void
}

const SettingDetailFormGroupItem: React.FC<Props> = ({
  settingProps,
  onValueChanged,
}) => {
  const [currentSettings, setCurrentSettings] =
    useState<SettingComponentProps>(settingProps)
  useEffect(() => {
    setCurrentSettings(settingProps)
  }, [setCurrentSettings, settingProps])
  if (!settingProps.children) return null

  const handleValueUpdated = (
    key: string,
    value: string | number | boolean
  ) => {
    if (!settingProps.children) return
    const child = settingProps.children.find((child) => child.key === key)
    if (!child) return
    child.controllerProps.value = value
    const newUpdatedSettings = {
      ...currentSettings,
      children: [],
    }
    settingProps.children.forEach((child: SettingComponentProps) => {
      ;(newUpdatedSettings.children as SettingComponentProps[]).push(child)
    })
    setCurrentSettings(newUpdatedSettings)
  }

  return (
    <div key={settingProps.key} className="flex flex-col">
      {settingProps.children.map((child) => {
        switch (child.controllerType) {
          case 'input': {
            return (
              <SettingDetailTextInputItem
                key={child.key}
                settingProps={child}
                onValueChanged={(value) => {
                  handleValueUpdated(child.key, value)
                }}
              />
            )
          }

          case 'checkbox': {
            return (
              <SettingDetailToggleItem
                key={child.key}
                settingProps={child}
                onValueChanged={(value) =>
                  handleValueUpdated(child.key, value.target.checked)
                }
              />
            )
          }

          default:
            return null
        }
      })}
      <div className="flex w-full flex-col items-end justify-between gap-4 border-b border-[hsla(var(--app-border))] py-2 first:pt-0 last:border-none sm:flex-row-reverse">
        <Button
          theme={'primary'}
          variant={'solid'}
          onClick={() => onValueChanged(currentSettings)}
        >
          Apply Settings
        </Button>
      </div>
    </div>
  )
}

export default SettingDetailFormGroupItem
