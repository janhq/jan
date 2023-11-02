'use client'

import { useAtomValue } from 'jotai'

import CreateBotContainer from '../CreateBotContainer'
import EmptyChatContainer from '../EmptyChatContainer'
import ExploreModelContainer from '../ExploreModelContainer'
import MainChat from '../MainChat'
import MyModelContainer from '../MyModelContainer'
import { Preferences } from '../Preferences'
import Welcome from '../WelcomeContainer'

import {
  MainViewState,
  getMainViewStateAtom,
} from '@/helpers/atoms/MainView.atom'

const MainView: React.FC = () => {
  const viewState = useAtomValue(getMainViewStateAtom)

  let children = null
  switch (viewState) {
    case MainViewState.ConversationEmptyModel:
      children = <EmptyChatContainer />
      break
    case MainViewState.ExploreModel:
      children = <ExploreModelContainer />
      break
    case MainViewState.Setting:
      children = <Preferences />
      break
    case MainViewState.ResourceMonitor:
    case MainViewState.MyModel:
      children = <MyModelContainer />
      break
    case MainViewState.CreateBot:
      children = <CreateBotContainer />
      break
    case MainViewState.Welcome:
      children = <Welcome />
      break
    default:
      children = <MainChat />
      break
  }

  return <div className="flex-1 overflow-hidden">{children}</div>
}

export default MainView
