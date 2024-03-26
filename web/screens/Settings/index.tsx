import { useEffect, useMemo, useState } from 'react'

import Advanced from '@/screens/Settings/Advanced'
import AppearanceOptions from '@/screens/Settings/Appearance'
import ExtensionCatalog from '@/screens/Settings/CoreExtensions'

import Models from '@/screens/Settings/Models'

import { SUCCESS_SET_NEW_DESTINATION } from './Advanced/DataFolder'
import ExtensionSetting from './ExtensionSetting'
import SettingMenu from './SettingMenu'

const handleShowOptions = (settingScreen: SettingScreen) => {
  switch (settingScreen) {
    case 'Extensions':
      return <ExtensionCatalog />

    case 'My Settings':
      return <AppearanceOptions />

    case 'Advanced Settings':
      return <Advanced />

    case 'My Models':
      return <Models />

    case 'Extension Settings':
      return <ExtensionSetting />

    default:
      return null
  }
}

export const SettingScreenList = [
  'My Models',
  'My Settings',
  'Advanced Settings',
  'Extensions',
  'Extension Settings',
] as const

export type SettingScreenTuple = typeof SettingScreenList
export type SettingScreen = SettingScreenTuple[number]

const SettingsScreen: React.FC = () => {
  const [activeSettingScreen, setActiveSettingScreen] =
    useState<SettingScreen>('My Models')

  useEffect(() => {
    if (localStorage.getItem(SUCCESS_SET_NEW_DESTINATION) === 'true') {
      setActiveSettingScreen('Advanced Settings')
      localStorage.removeItem(SUCCESS_SET_NEW_DESTINATION)
    }
  }, [])

  const availableSettingScreens = useMemo(() => {
    return SettingScreenList.filter((screen) => {
      if (
        !window.electronAPI &&
        (screen === 'Extensions' || screen === 'Extension Settings')
      ) {
        return false
      }

      return true
    })
  }, [])

  return (
    <div
      className="flex h-full bg-background"
      data-testid="testid-setting-description"
    >
      <SettingMenu
        activeSettingScreen={activeSettingScreen}
        onMenuClick={setActiveSettingScreen}
        settingsScreens={availableSettingScreens}
      />

      {handleShowOptions(activeSettingScreen)}
    </div>
  )
}

export default SettingsScreen
