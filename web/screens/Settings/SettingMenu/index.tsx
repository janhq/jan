import React from 'react'

import { ScrollArea } from '@janhq/uikit'
import { motion as m } from 'framer-motion'
import { twMerge } from 'tailwind-merge'

import { SettingScreen } from '..'

type Props = {
  settingsScreens: SettingScreen[]
  activeSettingScreen: SettingScreen
  onMenuClick: (settingScreen: SettingScreen) => void
}

const SettingMenu: React.FC<Props> = ({
  settingsScreens,
  activeSettingScreen,
  onMenuClick,
}) => (
  <div className="flex h-full w-64 flex-shrink-0 flex-col overflow-y-auto border-r border-border">
    <ScrollArea className="h-full w-full">
      <div className="flex-shrink-0 px-6 py-4 font-medium">
        {settingsScreens.map((settingScreen) => {
          const isActive = activeSettingScreen === settingScreen
          return (
            <div
              key={settingScreen}
              className="relative my-0.5 block cursor-pointer py-1.5"
              onClick={() => onMenuClick(settingScreen)}
            >
              <span className={twMerge(isActive && 'relative z-10')}>
                {settingScreen}
              </span>

              {isActive && (
                <m.div
                  className="absolute inset-0 -left-3 h-full w-[calc(100%+24px)] rounded-md bg-primary/50"
                  layoutId="active-static-menu"
                />
              )}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  </div>
)

export default React.memo(SettingMenu)
