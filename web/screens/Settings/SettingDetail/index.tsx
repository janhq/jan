import { useAtomValue } from 'jotai'

import Advanced from '@/screens/Settings/Advanced'
import AppearanceOptions from '@/screens/Settings/Appearance'
import ExtensionCatalog from '@/screens/Settings/CoreExtensions'
import ExtensionSetting from '@/screens/Settings/ExtensionSetting'
import Hotkeys from '@/screens/Settings/Hotkeys'
import MyModels from '@/screens/Settings/MyModels'
import Privacy from '@/screens/Settings/Privacy'

import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const SettingDetail = () => {
  const selectedSetting = useAtomValue(selectedSettingAtom)

  switch (selectedSetting) {
    case 'Extensions':
      return <ExtensionCatalog />

    case 'Preferences':
      return <AppearanceOptions />

    case 'Keyboard Shortcuts':
      return <Hotkeys />

    case 'Privacy':
      return <Privacy />

    case 'Advanced Settings':
      return <Advanced />

    case 'My Models':
      return <MyModels />

    default:
      return <ExtensionSetting />
  }
}

export default SettingDetail
