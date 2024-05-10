import { useAtomValue } from 'jotai'

import { MainViewState } from '@/constants/screens'

import HubScreen from '@/screens/Hub'
import LocalServerScreen from '@/screens/LocalServer'
import SettingsScreen from '@/screens/Settings'
import ThreadScreen from '@/screens/Thread'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'

const MainViewContainer: React.FC = () => {
  const mainViewState = useAtomValue(mainViewStateAtom)

  let children = null
  switch (mainViewState) {
    case MainViewState.Hub:
      children = <HubScreen />
      break

    case MainViewState.Settings:
      children = <SettingsScreen />
      break

    case MainViewState.LocalServer:
      children = <LocalServerScreen />
      break

    default:
      children = <ThreadScreen />
      break
  }

  return children
}

export default MainViewContainer
