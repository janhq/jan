'use client'

import React from 'react'

import { useAtomValue } from 'jotai'

import BaseLayout from '@/containers/Layout'

import BotScreen from '@/screens/Bot'
import ChatScreen from '@/screens/Chat'
import EmptyChatScreen from '@/screens/Chat/EmptyChatScreen'
import ExploreModelsScreen from '@/screens/ExploreModels'
import MyModelsScreen from '@/screens/MyModels'
import SettingsScreen from '@/screens/Settings'
import WelcomeScreen from '@/screens/Welcome'

import {
  MainViewState,
  getMainViewStateAtom,
} from '@/helpers/atoms/MainView.atom'

export default function Page() {
  const viewState = useAtomValue(getMainViewStateAtom)

  let children = null
  switch (viewState) {
    case MainViewState.ConversationEmptyModel:
      children = <EmptyChatScreen />
      break

    case MainViewState.Welcome:
      children = <WelcomeScreen />
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
