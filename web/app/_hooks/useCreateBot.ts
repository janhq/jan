import { executeSerial } from '../../../electron/core/plugin-manager/execution/extension-manager'

export default function useCreateBot() {
  const createBot = async (bot: Bot) => {
    try {
      await executeSerial('createBot', bot)
    } catch (err) {
      alert(err)
      console.error(err)
    }
  }

  return { createBot }
}
