/**
 * @description Bulk thread operations confirmation dialog
 * @module containers/dialogs/BulkThreadActionsDialog
 * @since 1.0.0
 */

import { useRef } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconTrash, IconAlertCircle } from '@tabler/icons-react'

interface BulkThreadActionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: 'delete' | 'unstar'
  threadCount: number
  onConfirm: () => void
}

export function BulkThreadActionsDialog({
  open,
  onOpenChange,
  action,
  threadCount,
  onConfirm,
}: BulkThreadActionsDialogProps) {
  const { t } = useTranslation()
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  const handleConfirm = () => {
    onConfirm()
    onOpenChange(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirm()
    }
  }

  const getDialogContent = () => {
    switch (action) {
      case 'delete':
        return {
          title: t('common:bulkActions.deleteThreadsTitle', {
            count: threadCount,
          }),
          description: t('common:bulkActions.deleteThreadsDescription', {
            count: threadCount,
            defaultValue: `Are you sure you want to delete ${threadCount} thread${threadCount > 1 ? 's' : ''}? This action cannot be undone.`,
          }),
          icon: <IconTrash size={20} className="text-destructive" />,
          buttonText: t('common:delete'),
          buttonVariant: 'destructive' as const,
        }
      case 'unstar':
        return {
          title: t('common:bulkActions.unstarThreadsTitle', {
            count: threadCount,
          }),
          description: t('common:bulkActions.unstarThreadsDescription', {
            count: threadCount,
            defaultValue: `Are you sure you want to remove ${threadCount} thread${threadCount > 1 ? 's' : ''} from favorites?`,
          }),
          icon: <IconAlertCircle size={20} className="text-left-panel-fg/60" />,
          buttonText: t('common:confirm', { defaultValue: 'Confirm' }),
          buttonVariant: 'default' as const,
        }
      default:
        return {
          title: '',
          description: '',
          icon: null,
          buttonText: '',
          buttonVariant: 'default' as const,
        }
    }
  }

  const content = getDialogContent()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[425px] max-w-[90vw]"
        onOpenAutoFocus={(e: Event) => {
          e.preventDefault()
          confirmButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            {content.icon}
            <DialogTitle>{content.title}</DialogTitle>
          </div>
          <DialogDescription>{content.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <DialogClose asChild>
            <Button variant="link" size="sm" className="w-full sm:w-auto">
              {t('common:cancel')}
            </Button>
          </DialogClose>
          <Button
            ref={confirmButtonRef}
            variant={content.buttonVariant}
            onClick={handleConfirm}
            onKeyDown={handleKeyDown}
            size="sm"
            className="w-full sm:w-auto"
            aria-label={content.buttonText}
          >
            {content.buttonText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
