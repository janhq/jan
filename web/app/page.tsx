'use client'

import BaseLayout from '@/containers/Layout'

import { MainViewState } from '@/constants/screens'

import { useMainViewState } from '@/hooks/useMainViewState'

import ChatScreen from '@/screens/Chat'
import ExploreModelsScreen from '@/screens/ExploreModels'
import MyModelsScreen from '@/screens/MyModels'
import SettingsScreen from '@/screens/Settings'
import WelcomeScreen from '@/screens/Welcome'

export default function Page() {
  const { mainViewState } = useMainViewState()

  let children = null
  switch (mainViewState) {
    case MainViewState.Welcome:
      children = <WelcomeScreen />
      break

    case MainViewState.ExploreModels:
      children = <ExploreModelsScreen />
      break

    case MainViewState.MyModels:
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
