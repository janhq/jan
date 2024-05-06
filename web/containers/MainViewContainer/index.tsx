import { useAtomValue } from 'jotai'

import { MainViewState } from '@/constants/screens'

import ChatScreen from '@/screens/Chat'
import HubScreen from '@/screens/Hub'
import LocalServerScreen from '@/screens/LocalServer'
import SettingsScreen from '@/screens/Settings'

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
      children = <ChatScreen />
      break
  }

  return children
}

export default MainViewContainer
