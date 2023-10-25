import { DataService } from '@janhq/core'
import { executeSerial } from '@services/pluginService'

export default function useGetBots() {
  const getAllBots = async (): Promise<Bot[]> => {
    try {
      const bots = await executeSerial(DataService.GetBots)
      return bots
    } catch (err) {
      alert(`Failed to get bots: ${err}`)
      console.error(err)
      return []
    }
  }

  const getBotById = async (botId: string): Promise<Bot | undefined> => {
    try {
      const bot: Bot = await executeSerial(DataService.GetBotById, botId)
      return bot
    } catch (err) {
      alert(`Failed to get bot ${botId}: ${err}`)
      console.error(err)
      return undefined
    }
  }

  return { getBotById, getAllBots }
}
