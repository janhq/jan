'use client'

import { useAtomValue } from 'jotai'

import BaseLayout from '@/containers/Layout'

import { MainViewState } from '@/constants/screens'

import ChatScreen from '@/screens/Chat'
import ExploreModelsScreen from '@/screens/ExploreModels'

import LocalServerScreen from '@/screens/LocalServer'
import SettingsScreen from '@/screens/Settings'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'

export default function Page() {
  const mainViewState = useAtomValue(mainViewStateAtom)

  let children = null
  switch (mainViewState) {
    case MainViewState.Hub:
      children = <ExploreModelsScreen />
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

  return <BaseLayout>{children}</BaseLayout>
}
