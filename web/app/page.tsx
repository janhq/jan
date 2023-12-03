'use client'

import BaseLayout from '@/containers/Layout'

import { MainViewState } from '@/constants/screens'

import { useMainViewState } from '@/hooks/useMainViewState'

import ChatScreen from '@/screens/Chat'
import ExploreModelsScreen from '@/screens/ExploreModels'

import SettingsScreen from '@/screens/Settings'
import SystemMonitorScreen from '@/screens/SystemMonitor'

export default function Page() {
  const { mainViewState } = useMainViewState()

  let children = null
  switch (mainViewState) {
    case MainViewState.Hub:
      children = <ExploreModelsScreen />
      break

    case MainViewState.Settings:
      children = <SettingsScreen />
      break

    case MainViewState.SystemMonitor:
      children = <SystemMonitorScreen />
      break

    default:
      children = <ChatScreen />
      break
  }

  return <BaseLayout>{children}</BaseLayout>
}
