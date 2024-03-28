import { useAtomValue } from 'jotai'

import Advanced from '../Advanced'
import AppearanceOptions from '../Appearance'
import ExtensionCatalog from '../CoreExtensions'
import ExtensionSetting from '../ExtensionSetting'
import Models from '../Models'

import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const SettingDetail: React.FC = () => {
  const selectedSetting = useAtomValue(selectedSettingAtom)

  switch (selectedSetting) {
    case 'Extensions':
      return <ExtensionCatalog />

    case 'My Settings':
      return <AppearanceOptions />

    case 'Advanced Settings':
      return <Advanced />

    case 'My Models':
      return <Models />

    default:
      return <ExtensionSetting />
  }
}

export default SettingDetail
