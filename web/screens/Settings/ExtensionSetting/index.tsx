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

  if (settings.length === 0) return null

  return (
    <div>
      <SettingComponent componentProps={settings} />
    </div>
  )
}

export default ExtensionSetting
