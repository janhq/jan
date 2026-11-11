import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/useThreads'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { folderOf } from '@/lib/chatFolder'
import { supportsCowork } from '@/lib/coworkSync'
import { isCoworkEnabled } from '@/lib/version'

/**
 * The folder attached to an existing chat thread. Unlike a home draft's folder
 * (useFolderDraft), it is saved on the thread and stays until detached; the
 * thread's tools read it from there.
 */
export function useChatFolder(threadId: string) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const selectedModel = useModelProvider((s) => s.selectedModel)
  const stored = useThreads((s) => s.threads[threadId]?.metadata?.folder)
  const setThreadFolder = useThreads((s) => s.setThreadFolder)
  // Same availability as a draft's folder: the desktop host, on builds that
  // ship the agent tools. A temporary chat keeps no folder.
  const available =
    supportsCowork() && isCoworkEnabled() && threadId !== TEMPORARY_CHAT_ID
  const folder = folderOf(stored)

  const save = useCallback(
    async (next: string | null) => {
      try {
        await setThreadFolder(threadId, next)
      } catch (error) {
        console.warn('[chat] could not save the folder:', error)
        toast.error(t('common:workspace.saveFailed'))
      }
    },
    [setThreadFolder, threadId, t]
  )

  const attach = useCallback(async () => {
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
    await save(picked)
  }, [save, selectedModel, serviceHub, t])

  return useMemo(
    () => ({
      available,
      folder: available ? folder : null,
      attach: () => void attach(),
      detach: () => void save(null),
    }),
    [available, folder, attach, save]
  )
}
