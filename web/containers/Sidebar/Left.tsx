import React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  MainViewState,
  getMainViewStateAtom,
  setMainViewStateAtom,
} from '@helpers/atoms/MainView.atom'
import CompactLogo from '@containers/Logo/CompactLogo'
import {
  MessageCircle,
  Settings,
  Bot,
  LayoutGrid,
  CpuIcon,
  BookOpen,
} from 'lucide-react'
import { motion as m, Variants } from 'framer-motion'
import { useGetDownloadedModels } from '@hooks/useGetDownloadedModels'
import { twMerge } from 'tailwind-merge'
import { showingBotListModalAtom } from '@helpers/atoms/Modal.atom'
import useGetBots from '@hooks/useGetBots'
import { useUserConfigs } from '@hooks/useUserConfigs'

export const SidebarLeft = () => {
  const [config] = useUserConfigs()
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
    if (!bots || bots?.length === 0) {
      alert('You have not created any bot')
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
      name: 'Getting Started',
      icon: <BookOpen size={20} className="flex-shrink-0" />,
      state: MainViewState.Welcome,
    },
    {
      name: 'Chat',
      icon: <MessageCircle size={20} className="flex-shrink-0" />,
      state: MainViewState.Conversation,
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
      name: 'Bot',
      icon: <Bot size={20} className="flex-shrink-0" />,
      state: MainViewState.CreateBot,
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
        width: config.sidebarLeftExpand ? 180 : 60,
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
      <div className="mt-2 flex h-full w-full flex-col justify-between pb-4">
        <div
          className={twMerge(
            'flex w-full flex-col',
            config.sidebarLeftExpand ? 'items-start' : 'items-center'
          )}
        >
          {menus.map((menu, i) => {
            const isActive = currentState === menu.state
            const isBotMenu = menu.name === 'Bot'
            return (
              <div className="relative w-full px-4 py-2" key={i}>
                <button
                  data-testid={menu.name}
                  className={twMerge(
                    'flex w-full flex-shrink-0 items-center gap-x-2',
                    config.sidebarLeftExpand
                      ? 'justify-start'
                      : 'justify-center'
                  )}
                  onClick={() =>
                    isBotMenu ? onBotListClick() : onMenuClick(menu.state)
                  }
                >
                  {menu.icon}
                  <m.span
                    initial={false}
                    variants={variant}
                    animate={config.sidebarLeftExpand ? 'show' : 'hide'}
                    className="text-xs font-semibold text-muted-foreground"
                  >
                    {menu.name}
                  </m.span>
                </button>
                {isActive ? (
                  <m.div
                    className="absolute inset-0 left-2 -z-10 h-full w-[calc(100%-16px)] rounded-md bg-accent/20 p-2 backdrop-blur-lg"
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
          animate={config.sidebarLeftExpand ? 'show' : 'hide'}
          className="flex flex-col space-y-2 px-3"
        >
          <div className="space-y-2 rounded-lg border border-border bg-background/50 p-3">
            <button
              onClick={() =>
                window.electronAPI?.openExternalUrl(
                  'https://discord.gg/AsJ8krTT3N'
                )
              }
              className="block text-xs font-semibold text-muted-foreground"
            >
              Discord
            </button>
            <button
              onClick={() =>
                window.electronAPI?.openExternalUrl(
                  'https://twitter.com/janhq_'
                )
              }
              className="block text-xs font-semibold text-muted-foreground"
            >
              Twitter
            </button>
          </div>
        </m.div>
      </div>
    </m.div>
  )
}
