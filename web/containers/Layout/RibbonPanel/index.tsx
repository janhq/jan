import { Tooltip } from '@janhq/joi'
import { motion as m } from 'framer-motion'
import { useAtom, useSetAtom } from 'jotai'
import {
  MessageCircleIcon,
  SettingsIcon,
  LayoutGridIcon,
  SquareCodeIcon,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { MainViewState } from '@/constants/screens'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { editMessageAtom } from '@/helpers/atoms/ChatMessage.atom'
import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

export default function RibbonPanel() {
  const [mainViewState, setMainViewState] = useAtom(mainViewStateAtom)
  const [serverEnabled] = useAtom(serverEnabledAtom)
  const setEditMessage = useSetAtom(editMessageAtom)

  const onMenuClick = (state: MainViewState) => {
    if (mainViewState === state) return
    if (serverEnabled && state === MainViewState.Thread) return
    setMainViewState(state)
    setEditMessage('')
  }

  const RibbonNavMenus = [
    {
      name: 'Thread',
      icon: <MessageCircleIcon size={18} className="flex-shrink-0" />,
      state: MainViewState.Thread,
    },
    {
      name: 'Hub',
      icon: <LayoutGridIcon size={18} className="flex-shrink-0" />,
      state: MainViewState.Hub,
    },
    {
      name: 'Local API Server',
      icon: <SquareCodeIcon size={18} className="flex-shrink-0" />,
      state: MainViewState.LocalServer,
    },
    {
      name: 'Settings',
      icon: <SettingsIcon size={18} className="flex-shrink-0" />,
      state: MainViewState.Settings,
    },
  ]

  return (
    <div className="flex w-12 flex-shrink-0 flex-col items-center border-r border-[hsla(var(--ribbon-panel-border))] bg-[hsla(var(--ribbon-panel-bg))] py-2">
      {RibbonNavMenus.filter((menu) => !!menu).map((menu, i) => {
        const isActive = mainViewState === menu.state
        return (
          <div
            className={twMerge(
              'relative my-0.5 flex h-8 w-8 items-center justify-center rounded-md hover:bg-[hsla(var(--ribbon-panel-icon-hover))]',
              i === 1 && 'mb-auto'
            )}
            key={i}
          >
            <Tooltip
              side="right"
              disabled={mainViewState === menu.state}
              trigger={
                <div>
                  <div
                    data-testid={menu.name}
                    className={twMerge(
                      'relative flex w-full flex-shrink-0 cursor-pointer items-center justify-center text-[hsla(var(--ribbon-panel-icon))] ',
                      isActive &&
                        'z-10 text-[hsla(var(--ribbon-panel-icon-active))]'
                    )}
                    onClick={() => onMenuClick(menu.state)}
                  >
                    {menu.icon}
                  </div>
                  {isActive && (
                    <m.div
                      className="absolute inset-0 left-0 h-full w-full rounded-md bg-[hsla(var(--ribbon-panel-icon-active-bg))]"
                      layoutId="active-state-menu"
                    />
                  )}
                </div>
              }
              content={
                serverEnabled && menu.state === MainViewState.Thread
                  ? 'Threads are disabled while the server is running'
                  : menu.name
              }
            />
          </div>
        )
      })}
    </div>
  )
}
