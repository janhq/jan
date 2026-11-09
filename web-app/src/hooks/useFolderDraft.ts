import { useCallback, useMemo, useState } from 'react'
import { useLocation, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { isTemporaryChatSearch } from '@/constants/chat'
import { supportsCowork } from '@/lib/coworkSync'
import {
  startCoworkFromDraft,
  type FolderDraftOutcome,
  type FolderDraftSubmission,
} from '@/lib/startCoworkFromDraft'
import type { ThreadFolder } from '@/services/projects/types'

/**
 * The folder half of a home-style draft (home and project pages). The folder is
 * route-local intent: it never carries over to another conversation, and a
 * temporary chat ignores it (it keeps no workspace).
 */
export function useFolderDraft(project?: ThreadFolder | null) {
  const { t } = useTranslation()
  const router = useRouter()
  const serviceHub = useServiceHub()
  const selectedModel = useModelProvider((s) => s.selectedModel)
  const [folder, setFolder] = useState<string | null>(null)
  const searchStr = useLocation({ select: (location) => location.searchStr })
  const isTemporaryChat = isTemporaryChatSearch(searchStr)
  // Folders need the desktop host; the browser build never offers one.
  const available = supportsCowork()
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

  const onFolderDraft = useCallback(
    (submission: FolderDraftSubmission): FolderDraftOutcome => {
      if (!activeFolder) return 'chat'
      const outcome = startCoworkFromDraft({
        folder: activeFolder,
        project,
        submission,
        navigate: (options) => router.navigate(options as never),
      })
      if (outcome === 'started') setFolder(null)
      return outcome
    },
    [activeFolder, project, router]
  )

  return useMemo(
    () => ({
      available,
      folder: activeFolder,
      attach: () => void attach(),
      detach: () => setFolder(null),
      onFolderDraft,
    }),
    [available, activeFolder, attach, onFolderDraft]
  )
}
