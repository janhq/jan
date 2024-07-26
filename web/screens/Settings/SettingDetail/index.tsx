import { useAtomValue } from 'jotai'

import Advanced from '@/screens/Settings/Advanced'
import AppearanceOptions from '@/screens/Settings/Appearance'

import ExtensionSetting from '@/screens/Settings/ExtensionSetting'
import Hotkeys from '@/screens/Settings/Hotkeys'
import MyModels from '@/screens/Settings/MyModels'

import EngineSetting from '../EngineSetting'

import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const SettingDetail = () => {
  const selectedSetting = useAtomValue(selectedSettingAtom)

  switch (selectedSetting) {
    case 'Appearance':
      return <AppearanceOptions />

    case 'Keyboard Shortcuts':
      return <Hotkeys />

    case 'Advanced Settings':
      return <Advanced />

    case 'My Models':
      return <MyModels />

    case 'Engines':
      return <EngineSetting />

    default:
      return <ExtensionSetting />
  }
}

export default SettingDetail
