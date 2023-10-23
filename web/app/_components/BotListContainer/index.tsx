import { activeBotAtom } from '@helpers/atoms/Bot.atom'
import { showingBotListModalAtom } from '@helpers/atoms/Modal.atom'
import useGetBots from '@hooks/useGetBots'
import { useAtom, useSetAtom } from 'jotai'
import React, { useEffect, useState } from 'react'
import Avatar from '../Avatar'
import {
  MainViewState,
  setMainViewStateAtom,
} from '@helpers/atoms/MainView.atom'

const BotListContainer: React.FC = () => {
  const [open, setOpen] = useAtom(showingBotListModalAtom)
  const setMainView = useSetAtom(setMainViewStateAtom)
  const [activeBot, setActiveBot] = useAtom(activeBotAtom)
  const [bots, setBots] = useState<Bot[]>([])
  const { getAllBots } = useGetBots()

  useEffect(() => {
    if (open) {
      getAllBots().then((res) => {
        setBots(res)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const onBotSelected = (bot: Bot) => {
    if (bot._id !== activeBot?._id) {
      setMainView(MainViewState.BotInfo)
      setActiveBot(bot)
    }
    setOpen(false)
  }

  return (
    <div className="bg-background/50 border-border overflow-hidden border shadow sm:rounded-md">
      <ul role="list" className="divide-y divide-gray-200">
        {bots.map((bot, i) => (
          <li
            role="button"
            key={i}
            className="flex items-center gap-4 p-4 hover:bg-hover-light sm:px-6"
            onClick={() => onBotSelected(bot)}
          >
            <Avatar />
            <div className="flex flex-1 flex-col">
              <p className="line-clamp-1">{bot.name}</p>
              <p className="text-muted-foreground mt-1 line-clamp-1 text-ellipsis">
                {bot._id}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default BotListContainer
