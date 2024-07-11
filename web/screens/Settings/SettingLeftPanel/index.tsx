import { memo } from 'react'

import LeftPanelContainer from '@/containers/LeftPanelContainer'

import { SettingScreenList } from '..'

import SettingItem from './SettingItem'

const SettingLeftPanel = () => {
  return (
    <LeftPanelContainer>
      <div className="flex-shrink-0 px-2 py-3">
        <div className="mb-1 px-2">
          <label className="text-xs font-medium text-[hsla(var(--text-secondary))]">
            General
          </label>
        </div>

        {SettingScreenList.map((settingScreen) => (
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

export default memo(SettingLeftPanel)
