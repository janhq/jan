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

const formatBytes = (bytes?: number) => {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exponent)
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

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
              <span className="text-sm font-normal text-main-view-fg/70 ml-2">
                ({currentIndex + 1} of {totalCount})
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {t('common:attachmentsIngestion.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="border border-main-view-fg/10 rounded-md p-3 bg-main-view/40">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium" title={currentAttachment.name}>
              {currentAttachment.name}
            </span>
            <span className="text-xs text-main-view-fg/70 flex-shrink-0">
              {formatBytes(currentAttachment.size)}
            </span>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:justify-end">
          <Button variant="ghost" onClick={cancel}>
            {t('common:cancel')}
          </Button>
          <Button
            variant="outline"
            className="border-main-view-fg/20"
            onClick={() => choose('embeddings')}
          >
            {t('common:attachmentsIngestion.embeddings')}
          </Button>
          <Button onClick={() => choose('inline')}>
            {t('common:attachmentsIngestion.inline')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
