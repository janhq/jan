import { useAtomValue } from 'jotai'

import Advanced from '@/screens/Settings/Advanced'
// import AppearanceOptions from '@/screens/Settings/Appearance'
import ExtensionCatalog from '@/screens/Settings/CoreExtensions'
import ExtensionSetting from '@/screens/Settings/ExtensionSetting'
import Hotkeys from '@/screens/Settings/Hotkeys'
import MyModels from '@/screens/Settings/MyModels'

import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const SettingDetail = () => {
  const selectedSetting = useAtomValue(selectedSettingAtom)

  switch (selectedSetting) {
    case 'Extensions':
      return <ExtensionCatalog />

    // Temporary disable
    // case 'Appearance':
    //   return <AppearanceOptions />

    case 'Hotkey & Shortcut':
      return <Hotkeys />

    case 'Advanced Settings':
      return <Advanced />

    case 'My Models':
      return <MyModels />

    default:
      return <ExtensionSetting />
  }
}

export default SettingDetail
