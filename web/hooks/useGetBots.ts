import { Bot } from '@models/Bot'
import { executeSerial } from '../../electron/core/plugin-manager/execution/extension-manager'

export default function useGetBots() {
  const getAllBots = async (): Promise<Bot[]> => {
    try {
      const bots = await executeSerial('getBots')
      return bots
    } catch (err) {
      alert(`Failed to get bots: ${err}`)
      console.error(err)
      return []
    }
  }

  const getBotById = async (botId: string): Promise<Bot | undefined> => {
    try {
      const bot: Bot = await executeSerial('getBotById', botId)
      return bot
    } catch (err) {
      alert(`Failed to get bot ${botId}: ${err}`)
      console.error(err)
      return undefined
    }
  }

  return { getBotById, getAllBots }
}
