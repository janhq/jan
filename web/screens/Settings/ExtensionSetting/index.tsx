import React, { useEffect, useState } from 'react'

import { SettingComponentProps } from '@janhq/core/.'

import SettingComponent from '@/screens/Chat/ModelSetting/SettingComponent'

import { extensionManager } from '@/extension'

const ExtensionSetting: React.FC = () => {
  const [settings, setSettings] = useState<SettingComponentProps[]>([])

  useEffect(() => {
    const getAllSettings = async () => {
      const activeExtensions = await extensionManager.getActive()

      const allSettings: SettingComponentProps[] = []

      for (const extension of activeExtensions) {
        const extensionName = extension.name
        if (!extensionName) continue

        const baseExtension = extensionManager.get(extensionName)
        if (!baseExtension) continue
        if (typeof baseExtension.getSettings === 'function') {
          const setting = await baseExtension.getSettings()
          if (setting) allSettings.push(...setting)
        }
      }
      setSettings(allSettings)
    }
    getAllSettings()
  }, [])

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
        const extension = extensionManager.get(extensionName)
        if (extension) {
          extension.updateSettings([setting]) // TODO: async
        }
      }

      return setting
    })

    setSettings(newSettings)
  }

  if (settings.length === 0) return null

  return (
    <SettingComponent
      componentProps={settings}
      onValueUpdated={onValueChanged}
    />
  )
}

export default ExtensionSetting
