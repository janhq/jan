import { Tooltip, useMediaQuery } from '@janhq/joi'
import { motion as m } from 'framer-motion'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { MessageCircleIcon, SettingsIcon, LayoutGridIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import {
  MainViewState,
  mainViewStateAtom,
  showLeftPanelAtom,
} from '@/helpers/atoms/App.atom'
import { editMessageAtom } from '@/helpers/atoms/ChatMessage.atom'

import {
  reduceTransparentAtom,
  selectedSettingAtom,
} from '@/helpers/atoms/Setting.atom'

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
    name: 'Settings',
    icon: <SettingsIcon size={18} className="flex-shrink-0" />,
    state: MainViewState.Settings,
  },
]

export default function RibbonPanel() {
  const [mainViewState, setMainViewState] = useAtom(mainViewStateAtom)
  const setEditMessage = useSetAtom(editMessageAtom)
  const showLeftPanel = useAtomValue(showLeftPanelAtom)
  const matches = useMediaQuery('(max-width: 880px)')
  const reduceTransparent = useAtomValue(reduceTransparentAtom)
  const setSelectedSetting = useSetAtom(selectedSettingAtom)

  const onMenuClick = (state: MainViewState) => {
    if (mainViewState === state) return
    if (state === MainViewState.Settings) setSelectedSetting('My Models')
    setMainViewState(state)
    setEditMessage('')
  }

  return (
    <div
      className={twMerge(
        'relative top-0 flex h-full w-12 flex-shrink-0 flex-col items-center border-r border-[hsla(var(--app-border))] py-2',
        mainViewState === MainViewState.Hub &&
          !reduceTransparent &&
          'border-none',
        !showLeftPanel && !reduceTransparent && 'border-none',
        matches && !reduceTransparent && 'border-none',
        reduceTransparent && ' bg-[hsla(var(--ribbon-panel-bg))]'
      )}
    >
      {RibbonNavMenus.filter((menu) => !!menu).map((menu, i) => {
        const isActive = mainViewState === menu.state
        return (
          <div
            key={i}
            className={twMerge(
              'mx-1 w-full cursor-pointer',
              i === 1 && 'mb-auto'
            )}
            onClick={() => onMenuClick(menu.state)}
          >
            <div
              className={twMerge(
                'relative mx-auto my-0.5 flex h-8 w-8 items-center justify-center rounded-md hover:bg-[hsla(var(--ribbon-panel-icon-hover))]'
              )}
            >
              <Tooltip
                side="right"
                disabled={mainViewState === menu.state}
                trigger={
                  <div>
                    <div
                      data-testid={menu.name}
                      className={twMerge(
                        'relative flex w-full flex-shrink-0 items-center justify-center text-[hsla(var(--ribbon-panel-icon))] ',
                        isActive &&
                          'z-10 text-[hsla(var(--ribbon-panel-icon-active))]'
                      )}
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
                content={menu.name}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
