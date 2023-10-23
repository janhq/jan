import { Bot } from '@/_models/Bot'
import { executeSerial } from '../../../electron/core/plugin-manager/execution/extension-manager'
import { DataService } from '@janhq/core'
import {
  MainViewState,
  setMainViewStateAtom,
} from '@/_helpers/atoms/MainView.atom'
import { useSetAtom } from 'jotai'
import { activeBotAtom } from '@/_helpers/atoms/Bot.atom'

export default function useCreateBot() {
  const setActiveBot = useSetAtom(activeBotAtom)
  const setMainViewState = useSetAtom(setMainViewStateAtom)

  const createBot = async (bot: Bot) => {
    try {
      await executeSerial(DataService.CreateBot, bot)
      setActiveBot(bot)
      setMainViewState(MainViewState.BotInfo)
    } catch (err) {
      alert(err)
      console.error(err)
    }
  }

  return { createBot }
}
