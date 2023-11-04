import { DataService } from '@janhq/core'

export default function useCreateBot() {
  const createBot = async (bot: Bot) => {
    try {
      // await executeSerial(DataService.CreateBot, bot)
    } catch (err) {
      alert(err)
      console.error(err)
    }
  }

  return { createBot }
}
