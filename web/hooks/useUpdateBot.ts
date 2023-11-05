export default function useUpdateBot() {
  const updateBot = async (
    bot: Bot,
    updatableField: UpdatableField
  ): Promise<void> => {
    try {
      // TODO: if bot does not changed, no need to update

      for (const [key, value] of Object.entries(updatableField)) {
        if (value !== undefined) {
          //@ts-ignore
          bot[key] = value
        }
      }

      // await executeSerial(DataService.UpdateBot, bot)
      console.debug('Bot updated', JSON.stringify(bot, null, 2))
    } catch (err) {
      alert(`Update bot error: ${err}`)
      console.error(err)
      return
    }
  }

  return { updateBot }
}

export type UpdatableField = {
  presencePenalty?: number
  frequencyPenalty?: number
  maxTokens?: number
  customTemperature?: number
  systemPrompt?: number
}
