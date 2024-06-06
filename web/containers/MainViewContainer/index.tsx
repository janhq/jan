import { useAtomValue } from 'jotai'

import { MainViewState } from '@/constants/screens'

import HubScreen2 from '@/screens/HubScreen2'
import SettingsScreen from '@/screens/Settings'
import ThreadScreen from '@/screens/Thread'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'

const MainViewContainer = () => {
  const mainViewState = useAtomValue(mainViewStateAtom)

  let children = null
  switch (mainViewState) {
    case MainViewState.Hub:
      children = <HubScreen2 />
      break

    case MainViewState.Settings:
      children = <SettingsScreen />
      break

    default:
      children = <ThreadScreen />
      break
  }

  return children
}

export default MainViewContainer
