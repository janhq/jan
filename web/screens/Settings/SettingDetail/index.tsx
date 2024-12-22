import { InferenceEngine } from '@janhq/core'
import { useAtomValue } from 'jotai'

import Advanced from '@/screens/Settings/Advanced'
import AppearanceOptions from '@/screens/Settings/Appearance'
import ExtensionCatalog from '@/screens/Settings/CoreExtensions'
import Engines from '@/screens/Settings/Engines'
import EngineSettings from '@/screens/Settings/Engines/Settings'
import ExtensionSetting from '@/screens/Settings/ExtensionSetting'
import Hotkeys from '@/screens/Settings/Hotkeys'
import MyModels from '@/screens/Settings/MyModels'
import Privacy from '@/screens/Settings/Privacy'

import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const SettingDetail = () => {
  const selectedSetting = useAtomValue(selectedSettingAtom)

  switch (selectedSetting) {
    case 'Engines':
      return <Engines />

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

    case InferenceEngine.cortex_llamacpp:
      return <EngineSettings engine={selectedSetting} />

    default:
      return <ExtensionSetting />
  }
}

export default SettingDetail
