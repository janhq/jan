import { useCallback, useMemo, useState } from 'react'
import { useLocation } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { isTemporaryChatSearch } from '@/constants/chat'
import { supportsCowork } from '@/lib/coworkSync'
import { isCoworkEnabled } from '@/lib/version'

/**
 * The folder half of a home-style draft (home and project pages). The folder is
 * route-local intent: the chat the draft creates starts with it attached
 * (see useChatFolder for a folder on an existing chat), it never carries over
 * to the next draft, and a temporary chat ignores it (it keeps no workspace).
 */
export function useFolderDraft() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const selectedModel = useModelProvider((s) => s.selectedModel)
  const [folder, setFolder] = useState<string | null>(null)
  const searchStr = useLocation({ select: (location) => location.searchStr })
  const isTemporaryChat = isTemporaryChatSearch(searchStr)
  // Folders need the desktop host; the browser build never offers one, and
  // builds without the agent tools have nothing to run on it.
  const available = supportsCowork() && isCoworkEnabled()
  const activeFolder = available && !isTemporaryChat ? folder : null

  const attach = useCallback(async () => {
    if (isTemporaryChat) {
      toast.info(t('common:conversationScope.temporary'))
      return
    }
    if (!selectedModel) {
      toast.info(t('common:conversationScope.folderSelectModel'))
      return
    }
    if (!selectedModel.capabilities?.includes('tools')) {
      toast.info(t('common:conversationScope.folderUnsupported'))
      return
    }
    const picked = await serviceHub.dialog().open({ directory: true })
    if (typeof picked !== 'string') return
    setFolder(picked)
  }, [isTemporaryChat, selectedModel, serviceHub, t])

  const detach = useCallback(() => setFolder(null), [])

  return useMemo(
    () => ({
      available,
      folder: activeFolder,
      attach: () => void attach(),
      detach,
    }),
    [available, activeFolder, attach, detach]
  )
}
