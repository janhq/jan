import { useEffect } from 'react'

import { useSetAtom } from 'jotai'

import CenterPanelContainer from '@/containers/CenterPanelContainer'

import SettingDetail from '@/screens/Settings/SettingDetail'
import SettingLeftPanel from '@/screens/Settings/SettingLeftPanel'

import { SUCCESS_SET_NEW_DESTINATION } from './Advanced/DataFolder'

import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

export const SettingScreenList = [
  'My Models',
  'Preferences',
  'Keyboard Shortcuts',
  'Hardware',
  'Privacy',
  'Advanced Settings',
  'Engines',
  'Extensions',
] as const

export type SettingScreenTuple = typeof SettingScreenList
export type SettingScreen = SettingScreenTuple[number]

const SettingsScreen = () => {
  const setSelectedSettingScreen = useSetAtom(selectedSettingAtom)

  useEffect(() => {
    if (localStorage.getItem(SUCCESS_SET_NEW_DESTINATION) === 'true') {
      setSelectedSettingScreen('Advanced Settings')
      localStorage.removeItem(SUCCESS_SET_NEW_DESTINATION)
    }
  }, [setSelectedSettingScreen])

  return (
    <div data-testid="testid-setting-description" className="flex h-full">
      <SettingLeftPanel />
      <CenterPanelContainer>
        <SettingDetail />
      </CenterPanelContainer>
    </div>
  )
}

export default SettingsScreen
