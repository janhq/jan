import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { IconCopy, IconCopyCheck } from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { toast } from 'sonner'
import { useState } from 'react'
import { useAppState } from '@/hooks/useAppState'

export default function ErrorDialog() {
  const { t } = useTranslation()
  const errorMessage = useAppState((state) => state.errorMessage)
  const setErrorMessage = useAppState((state) => state.setErrorMessage)
  const [isCopying, setIsCopying] = useState(false)
  const [isDetailExpanded, setIsDetailExpanded] = useState(true)

  const handleCopy = async () => {
    setIsCopying(true)
    try {
      await navigator.clipboard.writeText(errorMessage?.message ?? '')
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
    setErrorMessage(open ? errorMessage : undefined)
  }

  return (
    <Dialog open={!!errorMessage} onOpenChange={handleDialogOpen}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="shrink-0">
              <AlertTriangle className="size-4 text-destructive" />
            </div>
            <div>
              <DialogTitle>{t('common:error')}</DialogTitle>
              <DialogDescription className="mt-1 text-main-view-fg/70">
                {errorMessage?.title ?? 'Something went wrong'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="bg-main-view-fg/2 p-2 border border-main-view-fg/5 rounded-lg space-y-2">
          <div>
            <div
              onClick={() => setIsDetailExpanded(!isDetailExpanded)}
              className="flex items-center gap-1 text-sm text-main-view-fg/60 hover:text-main-view-fg/80 transition-colors cursor-pointer"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setIsDetailExpanded(!isDetailExpanded)
                }
              }}
            >
              {isDetailExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              Details
            </div>

            {isDetailExpanded && (
              <div
                className="mt-2 text-sm text-main-view-fg/70 leading-relaxed max-h-[150px] overflow-y-auto break-all bg-main-view-fg/10 p-2 rounded border border-main-view-fg/5"
                ref={(el) => {
                  if (el) {
                    el.scrollTop = el.scrollHeight
                  }
                }}
              >
                {errorMessage?.message}
              </div>
            )}
          </div>
          <span className="text-sm text-main-view-fg/60">{errorMessage?.subtitle}</span>
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
