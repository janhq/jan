import React, { useState } from 'react'

import { InferenceEngine } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { useGetEngines } from '@/hooks/useEngineManagement'

import Advanced from '@/screens/Settings/Advanced'
import ProxySettings from '@/screens/Settings/Advanced/ProxySettings'
import AppearanceOptions from '@/screens/Settings/Appearance'
import ExtensionCatalog from '@/screens/Settings/CoreExtensions'
import Engines from '@/screens/Settings/Engines'
import LocalEngineSettings from '@/screens/Settings/Engines/LocalEngineSettings'
import RemoteEngineSettings from '@/screens/Settings/Engines/RemoteEngineSettings'
import ExtensionSetting from '@/screens/Settings/ExtensionSetting'
import Hardware from '@/screens/Settings/Hardware'
import Hotkeys from '@/screens/Settings/Hotkeys'
import MyModels from '@/screens/Settings/MyModels'
import Privacy from '@/screens/Settings/Privacy'

import { isLocalEngine } from '@/utils/modelEngine'

import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const SettingDetail = () => {
  const selectedSetting = useAtomValue(selectedSettingAtom)
  const { engines } = useGetEngines()
  const [subdir, setSubdir] = useState<string | null>(null)

  switch (selectedSetting) {
    case 'Engines':
      return <Engines />

    case 'Extensions':
      return <ExtensionCatalog />

    case 'Preferences':
      return <AppearanceOptions />

    case 'Keyboard Shortcuts':
      return <Hotkeys />

    case 'Hardware':
      return <Hardware />

    case 'Privacy':
      return <Privacy />

    case 'Advanced Settings':
      switch (subdir) {
        case 'proxy':
          return <ProxySettings onBack={() => setSubdir(null)} />
        default:
          return <Advanced setSubdir={setSubdir} />
      }

    case 'My Models':
      return <MyModels />

    default:
      if (
        !selectedSetting.includes('@janhq') &&
        isLocalEngine(engines, selectedSetting as InferenceEngine)
      ) {
        return (
          <LocalEngineSettings engine={selectedSetting as InferenceEngine} />
        )
      } else if (
        !selectedSetting.includes('@janhq') &&
        !isLocalEngine(engines, selectedSetting as InferenceEngine)
      ) {
        return (
          <RemoteEngineSettings engine={selectedSetting as InferenceEngine} />
        )
      }
      return (
        <div className="mx-4">
          <ExtensionSetting />
        </div>
      )
  }
}

export default SettingDetail
