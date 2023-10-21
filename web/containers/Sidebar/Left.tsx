import React from 'react'

import { leftSideBarExpandStateAtom } from '@helpers/atoms/SideBarExpand.atom'
import { useAtomValue, useSetAtom } from 'jotai'

import {
  MainViewState,
  getMainViewStateAtom,
  setMainViewStateAtom,
} from '@helpers/atoms/MainView.atom'

import CompactLogo from '@containers/Logo/CompactLogo'

import { MessageCircle, Settings, Bot, LayoutGrid, CpuIcon } from 'lucide-react'
import { motion as m, Variants, AnimatePresence } from 'framer-motion'
import { useGetDownloadedModels } from '@hooks/useGetDownloadedModels'

import { twMerge } from 'tailwind-merge'
import { showingBotListModalAtom } from '@helpers/atoms/Modal.atom'
import useGetBots from '@hooks/useGetBots'

export const SidebarLeft = () => {
  const isLeftSidebarVisible = useAtomValue(leftSideBarExpandStateAtom)
  const getCurrentYear = new Date().getFullYear()

  const currentState = useAtomValue(getMainViewStateAtom)
  const setMainViewState = useSetAtom(setMainViewStateAtom)
  const setBotListModal = useSetAtom(showingBotListModalAtom)
  const { downloadedModels } = useGetDownloadedModels()
  const { getAllBots } = useGetBots()

  const onMenuClick = (mainViewState: MainViewState) => {
    if (currentState === mainViewState) return
    setMainViewState(mainViewState)
  }

  const onBotListClick = async () => {
    const bots = await getAllBots()
    if (bots.length === 0) {
      alert('You have no bot')
      return
    }
    if (downloadedModels.length === 0) {
      alert('You have no model downloaded')
      return
    }
    setBotListModal(true)
  }

  const variant: Variants = {
    hide: {
      opacity: 0,
      display: 'none',
      transition: {
        delay: 0,
      },
    },
    show: {
      opacity: 1,
      display: 'inline-block',
      transition: {
        duration: 0.5,
        delay: 0.4,
      },
    },
  }

  const menus = [
    {
      name: 'Chat',
      icon: <MessageCircle size={20} className="flex-shrink-0" />,
      state: MainViewState.Conversation,
    },
    {
      name: 'Bot',
      icon: <Bot size={20} className="flex-shrink-0" />,
      state: MainViewState.CreateBot,
    },
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
    {
      name: 'Settings',
      icon: <Settings size={20} className="flex-shrink-0" />,
      state: MainViewState.Setting,
    },
  ]

  return (
    <m.div
      initial={false}
      animate={{
        width: isLeftSidebarVisible ? 180 : 60,
        transition: {
          duration: 0.5,
          type: 'spring',
          stiffness: 100,
          damping: 15,
        },
      }}
      className="flex flex-shrink-0 flex-col pb-6 pt-14"
    >
      <div className="flex-shrink-0 px-4">
        <CompactLogo width={32} height={32} />
      </div>
      <div className="mt-4 flex h-full w-full flex-col justify-between gap-y-1">
        <div
          className={twMerge(
            'flex w-full flex-col',
            isLeftSidebarVisible ? 'items-start' : 'items-center'
          )}
        >
          {menus.map((menu, i) => {
            const isActive = currentState === menu.state
            return (
              <div className="relative w-full px-4 py-2" key={i}>
                <button
                  className={twMerge(
                    'flex w-full flex-shrink-0 items-center gap-x-2',
                    isLeftSidebarVisible ? 'justify-start' : 'justify-center'
                  )}
                  onClick={() => onMenuClick(menu.state)}
                >
                  {menu.icon}
                  <m.span
                    initial={false}
                    variants={variant}
                    animate={isLeftSidebarVisible ? 'show' : 'hide'}
                    className="text-xs font-semibold dark:text-gray-400"
                  >
                    {menu.name}
                  </m.span>
                </button>
                {isActive ? (
                  <m.div
                    className="absolute inset-0 left-2 -z-10 h-full w-[calc(100%-16px)] rounded-md bg-blue-300/50 p-2 backdrop-blur-lg dark:bg-gray-950/50"
                    layoutId="active-state"
                  />
                ) : null}
              </div>
            )
          })}
        </div>

        <m.div
          initial={false}
          variants={variant}
          animate={isLeftSidebarVisible ? 'show' : 'hide'}
          className="flex flex-col space-y-2 px-4"
        >
          <div className="space-y-2 rounded-md bg-gray-50/50 px-3 py-2 dark:bg-gray-950/50">
            <p className="text-xs dark:text-gray-400">Twitter</p>
            <p className="text-xs dark:text-gray-400">Github</p>
            <p className="text-xs dark:text-gray-400">Discord</p>
          </div>
          <div className="rounded-md bg-gray-50/50 p-2 dark:bg-gray-950/50">
            <p className="text-xs dark:text-gray-400">
              &copy;{getCurrentYear}&nbsp;Jan AI Pte Ltd.
            </p>
          </div>
        </m.div>
      </div>
    </m.div>
  )
}
