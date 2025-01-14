import React, { useCallback, useEffect, useState } from 'react'
import { SettingComponentProps } from '@janhq/core'
import SettingDetailItem from '@/screens/Settings/SettingDetail/SettingDetailItem'
import { extensionManager } from '@/extension'

const AccountSettings: React.FC = () => {
  const [settings, setSettings] = useState<SettingComponentProps[]>([])

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const extension = extensionManager.get('user-preferences')
        if (extension) {
          const settings = await extension.getSettings()
          setSettings(settings)
        }
      } catch (error) {
        console.error('Failed to load settings:', error)
      }
    }

    loadSettings()
  }, [])

  const handleSettingUpdate = useCallback(async (key: string, value: string | number | boolean | string[]) => {
    try {
      await extensionManager.setSetting('user-preferences', key, value)
    } catch (error) {
      console.error('Failed to update setting:', error)
    }
  }, [])

  return (
    <div className="flex flex-col space-y-6 p-6">
      <h2 className="text-xl font-semibold">Account Settings</h2>
      <SettingDetailItem
        componentProps={settings}
        onValueUpdated={handleSettingUpdate}
      />
    </div>
  )
}

export default AccountSettings
