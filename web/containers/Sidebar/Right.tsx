import BotInfo from '@/components/BotInfo'
import BotSetting from '@/components/BotSetting'

export const SidebarRight = () => {
  return (
    <div className="flex w-60 flex-shrink-0 flex-col px-4 py-6">
      <BotInfo />
      <BotSetting />
    </div>
  )
}
