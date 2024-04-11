import { useEffect } from 'react'

import { useSetAtom } from 'jotai'

import { SUCCESS_SET_NEW_DESTINATION } from './Advanced/DataFolder'

import SettingDetail from './SettingDetail'
import SettingMenu from './SettingMenu'

import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

export const SettingScreenList = [
  'My Models',
  'My Settings',
  'Advanced Settings',
  'Extensions',
] as const

export type SettingScreenTuple = typeof SettingScreenList
export type SettingScreen = SettingScreenTuple[number]

const SettingsScreen: React.FC = () => {
  const setSelectedSettingScreen = useSetAtom(selectedSettingAtom)
  useEffect(() => {
    if (localStorage.getItem(SUCCESS_SET_NEW_DESTINATION) === 'true') {
      setSelectedSettingScreen('Advanced Settings')
      localStorage.removeItem(SUCCESS_SET_NEW_DESTINATION)
    }
  }, [setSelectedSettingScreen])

  return (
    <div
      data-testid="testid-setting-description"
      className="flex h-full bg-background"
    >
      <SettingMenu />
      <SettingDetail />
    </div>
  )
}

export default SettingsScreen
