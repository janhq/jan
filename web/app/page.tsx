'use client'

import { useAtomValue } from 'jotai'
import WelcomeScreen from '@screens/Welcome'
import BotScreen from '@screens/Bot'
import ChatScreen from '@screens/Chat'
import ExploreModelsScreen from '@screens/ExploreModels'
import MyModelsScreen from '@screens/MyModels'
import SettingsScreen from '@screens/Settings'
import EmptyChatScreen from '@screens/Chat/EmptyChatScreen'

import {
  MainViewState,
  getMainViewStateAtom,
} from '@helpers/atoms/MainView.atom'

import React from 'react'

import BaseLayout from '@containers/Layout'

const Page: React.FC = () => {
  const viewState = useAtomValue(getMainViewStateAtom)

  let children = null
  switch (viewState) {
    case MainViewState.ConversationEmptyModel:
      children = <EmptyChatScreen />
      break

    case MainViewState.Welcome:
      children = <MyModelsScreen />
      break

    case MainViewState.Conversation:
      children = <ChatScreen />
      break

    case MainViewState.CreateBot:
      children = <BotScreen />
      break

    case MainViewState.ExploreModel:
      children = <ExploreModelsScreen />
      break

    case MainViewState.ResourceMonitor:
    case MainViewState.MyModel:
      children = <MyModelsScreen />
      break

    case MainViewState.Setting:
      children = <SettingsScreen />
      break

    default:
      children = <ChatScreen />
      break
  }

  return <BaseLayout>{children}</BaseLayout>
}

export default Page
