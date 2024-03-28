import React, { useEffect, useState } from 'react'

import { SettingComponentProps } from '@janhq/core/.'

import { useAtomValue } from 'jotai'

import SettingDetailItem from '../SettingDetail/SettingDetailItem'

import { extensionManager } from '@/extension'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const ExtensionSetting: React.FC = () => {
  const selectedExtensionName = useAtomValue(selectedSettingAtom)
  const [settings, setSettings] = useState<SettingComponentProps[]>([])

  useEffect(() => {
    const getExtensionSettings = async () => {
      if (!selectedExtensionName) return
      const allSettings: SettingComponentProps[] = []
      const baseExtension = extensionManager.get(selectedExtensionName)
      if (!baseExtension) return
      if (typeof baseExtension.getSettings === 'function') {
        const setting = await baseExtension.getSettings()
        if (setting) allSettings.push(...setting)
      }

      setSettings(allSettings)
    }
    getExtensionSettings()
  }, [selectedExtensionName])

  const onValueChanged = async (
    key: string,
    value: string | number | boolean
  ) => {
    // find the key in settings state, update it and set the state back
    const newSettings = settings.map((setting) => {
      if (setting.key !== key) return setting
      setting.controllerProps.value = value

      const extensionName = setting.extensionName
      if (extensionName) {
        extensionManager.get(extensionName)?.updateSettings([setting])
      }

      return setting
    })

    setSettings(newSettings)
  }

  if (settings.length === 0) return null

  return (
    <SettingDetailItem
      componentProps={settings}
      onValueUpdated={onValueChanged}
    />
  )
}

export default ExtensionSetting
