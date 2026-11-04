import { useCallback, useRef, useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { CoworkWorkspacePill } from '@/containers/CoworkWorkspacePill'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/useThreads'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import {
  HostRevokeUnconfirmedError,
  isConversationFolderPath,
  resolveConversationCapabilities,
} from '@/lib/conversationCapabilities'
import { isCoworkThread } from '@/lib/threadMode'

/** The thread's folder grant and actions, shared by the pill and the + menu. */
function useThreadFolder(threadId: string) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const thread = useThreads((s) => s.threads[threadId])
  const folder = useThreads((s) => s.getConversationCapabilities(threadId).folderScope?.path ?? null)
  const persistedFolder = resolveConversationCapabilities(thread?.metadata?.conversationCapabilities).folderScope
  // The strict setter denies synchronously, including clearing persisted metadata.
  // Keep a retry affordance if its subsequent host/persistence operation fails.
  const [recovery, setRecovery] = useState<{ threadId: string; folder: typeof persistedFolder; requestedScope: typeof persistedFolder; error: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const sequence = useRef(0)
  const savedFolder = persistedFolder ?? (recovery?.threadId === threadId ? recovery.folder : null)
  // Keep removal intent (null) distinct from the saved folder used for display.
  const retryScope = recovery?.threadId === threadId ? recovery.requestedScope : null
  const error = recovery?.threadId === threadId ? recovery.error : ''
  const access = useThreads((s) => s.getConversationCapabilities(threadId).folderScope?.access ?? 'write')

  const apply = useCallback(
    async (folderScope: { path: string; access: 'read' | 'write' } | null) => {
      const current = resolveConversationCapabilities(
        useThreads.getState().getConversationCapabilities(threadId)
      )
      const seq = ++sequence.current
      setSaving(true)
      setRecovery({ threadId, folder: folderScope ?? savedFolder, requestedScope: folderScope, error: '' })
      try {
        await useThreads.getState().setConversationCapabilities(threadId, { ...current, folderScope })
        if (sequence.current === seq) setRecovery(null)
      } catch (error) {
        if (sequence.current === seq) {
          const message = t(error instanceof HostRevokeUnconfirmedError && error.backgroundMayPersist
            ? 'common:conversationScope.hostRevokeUnconfirmed'
            : 'common:conversationScope.saveFailed')
          setRecovery({ threadId, folder: folderScope ?? savedFolder, requestedScope: folderScope, error: message })
          toast.error(message)
        }
      } finally {
        if (sequence.current === seq) setSaving(false)
      }
    },
    [threadId, t, savedFolder]
  )

  const attach = useCallback(async () => {
    const picked = await serviceHub.dialog().open({ directory: true })
    if (typeof picked !== 'string') return
    if (!isConversationFolderPath(picked)) {
      toast.error(t('common:conversationScope.invalidFolder'))
      return
    }
    await apply({ path: picked, access: 'write' })
  }, [serviceHub, apply, t])
  return { thread, folder, access, retryScope, saving, error, apply, attach }
}

export function ThreadWorkspacePill({ threadId }: { threadId: string }) {
  const { t } = useTranslation()
  const { thread, folder, access, retryScope, saving, error, apply, attach } = useThreadFolder(threadId)
  if (!thread || threadId === TEMPORARY_CHAT_ID || isCoworkThread(thread) || (!folder && !error)) return null
  return (
    <div className="mb-2 space-y-1">
      {folder ? <CoworkWorkspacePill
        folder={folder}
        access={access}
        onAccessChange={(next) => folder && void apply({ path: folder, access: next })}
        onAttach={() => void attach()}
        onDetach={() => void apply(null)}
      /> : null}
      {error && <div className="flex gap-2">
        <Button variant="outline" size="sm" className="h-7" disabled={saving} onClick={() => void apply(retryScope)}>
          {t('common:run.tryAgain')}
        </Button>
        <Button variant="ghost" size="sm" className="h-7" disabled={saving} onClick={() => void apply(null)}>
          {t('common:conversationScope.removeFolder')}
        </Button>
      </div>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** "Add folder" for the + menu of an existing conversation. With the shield gone
 * this is the only way to give a conversation that already started a folder. */
export function ThreadAddFolderItem({ threadId }: { threadId: string }) {
  const { t } = useTranslation()
  const { thread, attach } = useThreadFolder(threadId)
  if (!thread || threadId === TEMPORARY_CHAT_ID || isCoworkThread(thread)) return null
  return (
    <DropdownMenuItem onSelect={() => void attach()}>
      <FolderPlus className="size-4 text-muted-foreground" />
      {t('common:homeMode.addFolderAction')}
    </DropdownMenuItem>
  )
}
