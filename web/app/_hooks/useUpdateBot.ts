import { Bot } from '@/_models/Bot'
import { executeSerial } from '../../../electron/core/plugin-manager/execution/extension-manager'

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

      await executeSerial('updateBot', bot)
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
  customTemperature?: number
  systemPrompt?: number
}
