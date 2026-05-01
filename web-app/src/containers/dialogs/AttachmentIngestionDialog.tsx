import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAttachmentIngestionPrompt } from '@/hooks/useAttachmentIngestionPrompt'
import { useTranslation } from '@/i18n'
import { formatBytes } from '@/lib/utils'

export default function AttachmentIngestionDialog() {
  const { t } = useTranslation()
  const { isModalOpen, currentAttachment, currentIndex, totalCount, choose, cancel } = useAttachmentIngestionPrompt()

  if (!isModalOpen || !currentAttachment) return null

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => !open && cancel()}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {t('common:attachmentsIngestion.title')}
            {totalCount > 1 && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({currentIndex + 1} of {totalCount})
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {t('common:attachmentsIngestion.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="border rounded-md p-3 bg-secondary">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium" title={currentAttachment.name}>
              {currentAttachment.name}
            </span>
            <span className="text-xs text-muted-foreground shrink-0">
              {currentAttachment.size && currentAttachment.size > 0
                ? formatBytes(currentAttachment.size, {
                    decimals: (value, unit) =>
                      unit === 'B' || value >= 10 ? 0 : 1,
                  })
                : ''}
            </span>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:justify-end">
          <Button size="sm" variant="ghost" onClick={cancel}>
            {t('common:cancel')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => choose('embeddings')}
          >
            {t('common:attachmentsIngestion.embeddings')}
          </Button>
          <Button size="sm" onClick={() => choose('inline')}>
            {t('common:attachmentsIngestion.inline')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
