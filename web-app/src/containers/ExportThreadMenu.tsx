import { memo, useCallback } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMessages } from '@/hooks/useMessages'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { exportConversation, cleanThreadTitle } from '@/lib/export-conversation'
import { toast } from 'sonner'

type ExportThreadMenuProps = {
  threadId: string
  threadTitle?: string
}

export const ExportThreadMenu = memo(function ExportThreadMenu({
  threadId,
  threadTitle,
}: ExportThreadMenuProps) {
  const { t } = useTranslation()
  const getMessages = useMessages((state) => state.getMessages)
  const serviceHub = useServiceHub()

  const handleExport = useCallback(
    async (format: 'markdown' | 'json') => {
      try {
        let messages = getMessages(threadId)
        if (messages.length === 0) {
          messages = await serviceHub.messages().fetchMessages(threadId)
        }

        if (messages.length === 0) {
          toast.error(t('common:toast.exportThread.empty'))
          return
        }

        exportConversation({
          threadTitle: cleanThreadTitle(threadTitle),
          messages,
          format,
        })
        toast.success(t('common:toast.exportThread.success'))
      } catch (error) {
        console.error('Failed to export conversation:', error)
        toast.error(t('common:toast.exportThread.error'))
      }
    },
    [threadId, threadTitle, getMessages, serviceHub, t]
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative z-50"
          title={t('common:exportThread')}
        >
          <Download className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onClick={() => handleExport('markdown')}>
          <span>{t('common:exportMarkdown')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('json')}>
          <span>{t('common:exportJson')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
