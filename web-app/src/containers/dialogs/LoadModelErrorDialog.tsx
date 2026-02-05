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
import { useModelLoad } from '@/hooks/useModelLoad'
import { toast } from 'sonner'
import { useState } from 'react'

export default function LoadModelErrorDialog() {
  const { t } = useTranslation()
  const { modelLoadError, setModelLoadError } = useModelLoad()
  const [isCopying, setIsCopying] = useState(false)
  const [isDetailExpanded, setIsDetailExpanded] = useState(true)

  const getErrorDetail = (error: string | object | undefined) => {
    if (!error || typeof error !== 'object') return null
    if ('details' in error) {
      return (error as { details?: string }).details
    }
    return null
  }

  const hasErrorDetail = (error: string | object | undefined) => {
    return Boolean(getErrorDetail(error))
  }

  const formatErrorForCopy = (error: string | object | undefined) => {
    if (!error) return ''

    if (typeof error === 'string') return error

    if (typeof error === 'object' && 'code' in error && 'message' in error) {
      const errorObj = error as {
        code?: string
        message: string
        details?: string
      }
      let copyText = errorObj.code
        ? `${errorObj.code}: ${errorObj.message}`
        : errorObj.message
      if (errorObj.details) {
        copyText += `\n\nDetails:\n${errorObj.details}`
      }
      return copyText
    }

    if (typeof error === 'object') {
      const errorObj = error as {
        code?: string
        message: string
        details?: string
      }

      return errorObj.message
    }

    return JSON.stringify(error)
  }

  const handleCopy = async () => {
    setIsCopying(true)
    try {
      await navigator.clipboard.writeText(formatErrorForCopy(modelLoadError))
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

        <div className="bg-main-view-fg/2 p-2 border border-main-view-fg/5 rounded-lg space-y-2">
          {typeof modelLoadError === 'object' &&
          modelLoadError &&
          'code' in modelLoadError &&
          'message' in modelLoadError ? (
            <div>
              {(modelLoadError as { code?: string }).code && (
                <div>
                  <p className="text-sm text-main-view-fg/80 leading-relaxed break-all">
                    {(modelLoadError as { code: string }).code}
                  </p>
                </div>
              )}
              <div>
                <p className="text-sm text-main-view-fg/60 leading-relaxed break-all">
                  {(modelLoadError as { message: string }).message}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-main-view-fg/70 leading-relaxed break-all">
              {String(modelLoadError)}
            </p>
          )}

          {hasErrorDetail(modelLoadError) && (
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
                  {getErrorDetail(modelLoadError)}
                </div>
              )}
            </div>
          )}
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
