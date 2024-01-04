import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipArrow,
} from '@janhq/uikit'
import { motion as m } from 'framer-motion'

import {
  MessageCircleIcon,
  SettingsIcon,
  MonitorIcon,
  LayoutGridIcon,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { MainViewState } from '@/constants/screens'

import { useMainViewState } from '@/hooks/useMainViewState'

export default function RibbonNav() {
  const { mainViewState, setMainViewState } = useMainViewState()

  const onMenuClick = (state: MainViewState) => {
    if (mainViewState === state) return
    setMainViewState(state)
  }

  const primaryMenus = [
    {
      name: 'Thread',
      icon: (
        <MessageCircleIcon
          size={20}
          className="flex-shrink-0 text-muted-foreground"
        />
      ),
      state: MainViewState.Thread,
    },
    {
      name: 'Hub',
      icon: (
        <LayoutGridIcon
          size={20}
          className="flex-shrink-0 text-muted-foreground"
        />
      ),
      state: MainViewState.Hub,
    },
  ]

  const secondaryMenus = [
    {
      name: 'System Monitor',
      icon: (
        <MonitorIcon
          size={20}
          className="flex-shrink-0 text-muted-foreground"
        />
      ),
      state: MainViewState.SystemMonitor,
    },
    {
      name: 'Settings',
      icon: (
        <SettingsIcon
          size={20}
          className="flex-shrink-0 text-muted-foreground"
        />
      ),
      state: MainViewState.Settings,
    },
  ]

  return (
    <div className="relative top-12 flex h-[calc(100%-48px)] w-16 flex-shrink-0 flex-col border-r border-border bg-background py-4">
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
                  <div className="relative flex p-2" key={i}>
                    <Tooltip>
                      <TooltipTrigger>
                        <div
                          data-testid={primary.name}
                          className={twMerge(
                            'relative flex w-full flex-shrink-0 cursor-pointer items-center justify-center',
                            isActive && 'z-10'
                          )}
                          onClick={() => onMenuClick(primary.state)}
                        >
                          {primary.icon}
                        </div>
                        {isActive && (
                          <m.div
                            className="absolute inset-0 left-0 h-full w-full rounded-md bg-gray-200 dark:bg-secondary"
                            layoutId="active-state-primary"
                          />
                        )}
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={10}>
                        <span>{primary.name}</span>
                        <TooltipArrow />
                      </TooltipContent>
                    </Tooltip>
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
                  <div className="relative flex p-2" key={i}>
                    <Tooltip>
                      <TooltipTrigger>
                        <div
                          data-testid={secondary.name}
                          className={twMerge(
                            'relative flex w-full flex-shrink-0 cursor-pointer items-center justify-center',
                            isActive && 'z-10'
                          )}
                          onClick={() => onMenuClick(secondary.state)}
                        >
                          {secondary.icon}
                        </div>
                        {isActive && (
                          <m.div
                            className="absolute inset-0 left-0 h-full w-full rounded-md bg-gray-200 dark:bg-secondary"
                            layoutId="active-state-secondary"
                          />
                        )}
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={10}>
                        <span>{secondary.name}</span>
                        <TooltipArrow />
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    </div>
  )
}
