import React from 'react'

import { useAtomValue } from 'jotai'

import LeftPanelContainer from '@/containers/LeftPanelContainer'

import { SettingScreen, SettingScreenList } from '..'

import SettingItem from './SettingItem'

import { experimentalFeatureEnabledAtom } from '@/helpers/atoms/AppConfig.atom'

const SettingLeftPanel: React.FC = () => {
  const experimentalEnabled = useAtomValue(experimentalFeatureEnabledAtom)

  const screenList: SettingScreen[] = Array.isArray(SettingScreenList)
    ? experimentalEnabled
      ? SettingScreenList
      : SettingScreenList.filter((screen) => screen !== 'Engines')
    : []

  return (
    <LeftPanelContainer>
      <div className="flex-shrink-0 px-2 py-3">
        <div className="mb-1 px-2">
          <label className="text-xs font-medium text-[hsla(var(--text-secondary))]">
            General
          </label>
        </div>

        {screenList.map((settingScreen) => (
          <SettingItem
            key={settingScreen}
            name={settingScreen}
            setting={settingScreen}
          />
        ))}
      </div>
    </LeftPanelContainer>
  )
}

export default React.memo(SettingLeftPanel)
