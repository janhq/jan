import { useSetAtom } from 'jotai'
import { executeSerial } from '../../electron/core/plugin-manager/execution/extension-manager'
import { activeBotAtom } from '@helpers/atoms/Bot.atom'
import { rightSideBarExpandStateAtom } from '@helpers/atoms/SideBarExpand.atom'

export default function useDeleteBot() {
  const setActiveBot = useSetAtom(activeBotAtom)
  const setRightPanelVisibility = useSetAtom(rightSideBarExpandStateAtom)

  const deleteBot = async (botId: string): Promise<'success' | 'failed'> => {
    try {
      await executeSerial('deleteBot', botId)
      setRightPanelVisibility(false)
      setActiveBot(undefined)
      return 'success'
    } catch (err) {
      alert(`Failed to delete bot ${botId}: ${err}`)
      console.error(err)
      return 'failed'
    }
  }

  return { deleteBot }
}
