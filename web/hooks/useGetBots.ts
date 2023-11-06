export default function useGetBots() {
  const getAllBots = async (): Promise<Bot[]> => {
    try {
      // const bots = await executeSerial(DataService.GetBots)
      return []
    } catch (err) {
      alert(`Failed to get bots: ${err}`)
      console.error(err)
      return []
    }
  }

  const getBotById = async (botId: string): Promise<Bot | undefined> => {
    try {
      // const bot: Bot = await executeSerial(DataService.GetBotById, botId)
      return undefined
    } catch (err) {
      alert(`Failed to get bot ${botId}: ${err}`)
      console.error(err)
      return undefined
    }
  }

  return { getBotById, getAllBots }
}
