import { useAtomValue } from 'jotai'

import Advanced from '@/screens/Settings/Advanced'
import AppearanceOptions from '@/screens/Settings/Appearance'
import ExtensionCatalog from '@/screens/Settings/CoreExtensions'
import ExtensionSetting from '@/screens/Settings/ExtensionSetting'
import Hotkeys from '@/screens/Settings/Hotkeys'
import MyModels from '@/screens/Settings/MyModels'
import Privacy from '@/screens/Settings/Privacy'
import AccountSettings from '@/screens/Settings/AccountSettings'

import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const SettingDetail = () => {
  const selectedSetting = useAtomValue(selectedSettingAtom)

  return (
    <div className="flex-1 overflow-y-auto">
      {selectedSetting === 'Account' && <AccountSettings />}
      {selectedSetting === 'Extensions' && <ExtensionCatalog />}
      {selectedSetting === 'Preferences' && <AppearanceOptions />}
      {selectedSetting === 'Keyboard Shortcuts' && <Hotkeys />}
      {selectedSetting === 'Privacy' && <Privacy />}
      {selectedSetting === 'Advanced Settings' && <Advanced />}
      {selectedSetting === 'My Models' && <MyModels />}
      {selectedSetting !== 'Account' && selectedSetting !== 'Extensions' && selectedSetting !== 'Preferences' && selectedSetting !== 'Keyboard Shortcuts' && selectedSetting !== 'Privacy' && selectedSetting !== 'Advanced Settings' && selectedSetting !== 'My Models' && <ExtensionSetting />}
    </div>
  )
}

export default SettingDetail
