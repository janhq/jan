import React, { useContext } from 'react'

import { motion as m } from 'framer-motion'

import {
  MessageCircle,
  Settings,
  Bot,
  LayoutGrid,
  CpuIcon,
  BookOpen,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'

// import useGetBots from '@/hooks/useGetBots'
// import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
// import { useUserConfigs } from '@/hooks/useUserConfigs'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { MainViewState } from '@/constants/screens'

import { useMainViewState } from '@/hooks/useMainViewState'

// import { showingBotListModalAtom } from '@/helpers/atoms/Modal.atom'

export default function RibbonNav() {
  // const [config] = useUserConfigs()
  const { mainViewState, setMainViewState } = useMainViewState()
  // const currentState = useAtomValue(getMainViewStateAtom)
  // const setMainViewState = useSetAtom(setMainViewStateAtom)
  // const setBotListModal = useSetAtom(showingBotListModalAtom)
  // const { downloadedModels } = useGetDownloadedModels()
  // const { getAllBots } = useGetBots()
  const { experimentalFeatureEnabed } = useContext(FeatureToggleContext)

  const onMenuClick = (state: MainViewState) => {
    if (mainViewState === state) return
    setMainViewState(state)
  }

  // const onBotListClick = async () => {
  //   const bots = await getAllBots()
  //   if (!bots || bots?.length === 0) {
  //     alert('You have not created any bot')
  //     return
  //   }

  //   if (downloadedModels.length === 0) {
  //     alert('You have no model downloaded')
  //     return
  //   }

  //   setBotListModal(true)
  // }

  const primaryMenus = [
    {
      name: 'Getting Started',
      icon: <BookOpen size={20} className="flex-shrink-0" />,
      state: MainViewState.Welcome,
    },
    {
      name: 'Chat',
      icon: <MessageCircle size={20} className="flex-shrink-0" />,
      state: MainViewState.Conversation,
    },
  ]

  const secondaryMenus = [
    {
      name: 'Explore Models',
      icon: <CpuIcon size={20} className="flex-shrink-0" />,
      state: MainViewState.ExploreModel,
    },
    {
      name: 'My Models',
      icon: <LayoutGrid size={20} className="flex-shrink-0" />,
      state: MainViewState.MyModel,
    },
    ...(experimentalFeatureEnabed
      ? [
          {
            name: 'Bot',
            icon: <Bot size={20} className="flex-shrink-0" />,
            state: MainViewState.CreateBot,
          },
        ]
      : []),
    {
      name: 'Settings',
      icon: <Settings size={20} className="flex-shrink-0" />,
      state: MainViewState.Setting,
    },
  ]
  return (
    <div className="flex w-16 flex-shrink-0 flex-col border-r border-border pb-4 pt-10">
      <div className="mt-2 flex h-full w-full flex-col items-center justify-between">
        <div className="flex h-full w-full flex-col items-center justify-between">
          <div>
            <div className="unselect mb-4">
              <LogoMark width={28} height={28} className="mx-auto" />
            </div>
            {primaryMenus
              .filter((primary) => !!primary)
              .map((primary, i) => {
                const isActive = mainViewState === primary.state
                return (
                  <div className="relative p-2" key={i}>
                    <button
                      data-testid={primary.name}
                      className={twMerge(
                        'relative flex w-full flex-shrink-0 items-center justify-center',
                        isActive && 'z-10'
                      )}
                      onClick={() => onMenuClick(primary.state)}
                    >
                      {primary.icon}
                    </button>
                    {isActive && (
                      <m.div
                        className="absolute inset-0 left-0 h-full w-full rounded-md bg-blue-600 p-2"
                        layoutId="active-state-primary"
                      />
                    )}
                  </div>
                )
              })}
          </div>

          <div>
            {secondaryMenus
              .filter((secondary) => !!secondary)
              .map((secondary, i) => {
                const isActive = mainViewState === secondary.state
                return (
                  <div className="relative p-2" key={i}>
                    <button
                      data-testid={secondary.name}
                      className={twMerge(
                        'relative flex w-full flex-shrink-0 items-center justify-center',
                        isActive && 'z-10'
                      )}
                      onClick={() => onMenuClick(secondary.state)}
                    >
                      {secondary.icon}
                    </button>
                    {isActive && (
                      <m.div
                        className="absolute inset-0 left-0 h-full w-full rounded-md bg-blue-600 p-2"
                        layoutId="active-state-secondary"
                      />
                    )}
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    </div>
  )
}
