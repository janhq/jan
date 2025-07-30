import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import { IconCopy, IconCopyCheck } from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useModelLoad } from '@/hooks/useModelLoad'
import { toast } from 'sonner'
import { useState } from 'react'

export default function LoadModelErrorDialog() {
  const { t } = useTranslation()
  const { modelLoadError, setModelLoadError } = useModelLoad()
  const [isCopying, setIsCopying] = useState(false)

  const handleCopy = async () => {
    setIsCopying(true)
    try {
      await navigator.clipboard.writeText(modelLoadError ?? '')
      toast.success('Copy successful', {
        id: 'copy-model',
        description: 'Model load error information copied to clipboard',
      })
    } catch {
      toast.error('Failed to copy', {
        id: 'copy-model-error',
        description: 'Failed to copy error information to clipboard',
      })
    } finally {
      setTimeout(() => setIsCopying(false), 2000)
    }
  }

  const handleDialogOpen = (open: boolean) => {
    setModelLoadError(open ? modelLoadError : undefined)
  }

  return (
    <Dialog open={!!modelLoadError} onOpenChange={handleDialogOpen}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="shrink-0">
              <AlertTriangle className="size-4 text-destructive" />
            </div>
            <div>
              <DialogTitle>{t('common:error')}</DialogTitle>
              <DialogDescription className="mt-1 text-main-view-fg/70">
                Something went wrong
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="bg-main-view-fg/8 p-2 border border-main-view-fg/5 rounded-lg">
          <p
            className="text-sm text-main-view-fg/70 leading-relaxed max-h-[200px] overflow-y-auto break-all"
            ref={(el) => {
              if (el) {
                el.scrollTop = el.scrollHeight
              }
            }}
          >
            {modelLoadError}
          </p>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-right">
          <Button
            variant="link"
            onClick={() => handleDialogOpen(false)}
            className="flex-1 text-right sm:flex-none"
          >
            {t('common:cancel')}
          </Button>
          <Button
            variant="link"
            onClick={() => handleCopy()}
            disabled={isCopying}
            autoFocus
            className="flex-1 text-right sm:flex-none border border-main-view-fg/20 !px-2"
          >
            {isCopying ? (
              <>
                <IconCopyCheck className="text-accent" />
                {t('common:copied')}
              </>
            ) : (
              <>
                <IconCopy />
                {t('common:copy')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
