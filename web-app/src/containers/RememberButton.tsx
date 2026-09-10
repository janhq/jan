import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { IconBookmark, IconBookmarkFilled } from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useThreads } from '@/hooks/useThreads'
import { rememberNote } from '@/lib/agentWorkspace'

/**
 * Chat's only write path into the shared agent memory: user-driven, one click
 * per assistant message. The note is named after the thread title and its full
 * text lands in the store both surfaces recall from. No silent model writes on
 * a surface that advertises no memory tools.
 */
export const RememberButton = ({ text }: { text: string }) => {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // The store lives behind the Tauri plugin; a web build has nowhere to write.
  if (!IS_TAURI || !text.trim()) return null

  const handleRemember = async () => {
    if (saving) return
    setSaving(true)
    try {
      const title = useThreads.getState().getCurrentThread()?.title ?? ''
      const { name, duplicate } = await rememberNote(title, text)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      toast.success(
        t(
          duplicate
            ? 'chat:actions.rememberExists'
            : 'chat:actions.rememberSaved',
          { name }
        )
      )
    } catch {
      toast.error(t('chat:actions.rememberFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleRemember}
      title={t('chat:actions.remember')}
    >
      {saved ? (
        <IconBookmarkFilled size={16} className="text-primary" />
      ) : (
        <IconBookmark size={16} />
      )}
    </Button>
  )
}
