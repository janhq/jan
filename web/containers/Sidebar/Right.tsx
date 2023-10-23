import React from 'react'
import BotSetting from '@/_components/BotSetting'
import BotInfo from '@/_components/BotInfo'

export const SidebarRight = () => {
  return (
    <div className="flex w-60 flex-shrink-0 flex-col px-4 py-6">
      <BotInfo />
      <BotSetting />
    </div>
  )
}
