import { useEffect, useState } from 'react'

import Advanced from '@/screens/Settings/Advanced'

import ExtensionCatalog from '@/screens/Settings/CoreExtensions'

import Models from '@/screens/Settings/Models'

import { SUCCESS_SET_NEW_DESTINATION } from './Advanced/DataFolder'
import SettingMenu from './SettingMenu'

const handleShowOptions = (menu: string) => {
  switch (menu) {
    case 'Extensions':
      return <ExtensionCatalog />

    case 'Advanced Settings':
      return <Advanced />

    case 'My Models':
      return <Models />
  }
}

const SettingsScreen: React.FC = () => {
  const [activeStaticMenu, setActiveStaticMenu] = useState('My Models')

  useEffect(() => {
    if (localStorage.getItem(SUCCESS_SET_NEW_DESTINATION) === 'true') {
      setActiveStaticMenu('Advanced Settings')
      localStorage.removeItem(SUCCESS_SET_NEW_DESTINATION)
    }
  }, [])

  return (
    <div
      className="flex h-full bg-background"
      data-testid="testid-setting-description"
    >
      <SettingMenu
        activeMenu={activeStaticMenu}
        onMenuClick={setActiveStaticMenu}
      />

      {handleShowOptions(activeStaticMenu)}
    </div>
  )
}

export default SettingsScreen
