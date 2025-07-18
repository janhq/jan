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
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useModelLoad } from '@/hooks/useModelLoad'
import { toast } from 'sonner'

export default function LoadModelErrorDialog() {
  const { t } = useTranslation()
  const { modelLoadError, setModelLoadError } = useModelLoad()

  const handleCopy = () => {
    navigator.clipboard.writeText(modelLoadError ?? '')
    toast.success('Copy successful', {
      id: 'copy-model',
      description: 'Model load error information copied to clipboard',
    })
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
              <AlertTriangle className="size-4" />
            </div>
            <div>
              <DialogTitle>{t('common:error')}</DialogTitle>
              <DialogDescription className="mt-1 text-main-view-fg/70">
                Failed to load model
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="bg-main-view-fg/8 p-2 border border-main-view-fg/5 rounded-lg">
          <p
            className="text-sm text-main-view-fg/70 leading-relaxed max-h-[200px] overflow-y-auto"
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
            onClick={() => handleCopy()}
            className="flex-1 text-right sm:flex-none"
          >
            {t('common:copy')}
          </Button>
          <Button
            variant="link"
            onClick={() => handleDialogOpen(false)}
            className="flex-1 text-right sm:flex-none"
          >
            {t('common:cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
