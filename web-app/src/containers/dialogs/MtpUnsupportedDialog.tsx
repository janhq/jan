import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface MtpUnsupportedDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelId: string
}

export function MtpUnsupportedDialog({
  open,
  onOpenChange,
  modelId,
}: MtpUnsupportedDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] max-w-[90vw]">
        <DialogHeader>
          <DialogTitle className="font-bold">
            {t('settings:mtpUnsupportedTitle', {
              defaultValue: "MTP isn't available for this model",
            })}
          </DialogTitle>
          <DialogDescription>
            {/* Composed manually instead of via i18n placeholders so the
                inline link to the Gemma 4 collection stays a real
                anchor element (the t() return is a plain string). */}
            <span>
              {t('settings:mtpUnsupportedDescPrefix', {
                defaultValue:
                  "{{modelId}} doesn't have a paired MTP assistant. Pick a supported Gemma 4 target from ",
                modelId,
              })}
            </span>
            <a
              href="https://huggingface.co/collections/mlx-community/gemma-4"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#1F7CFF' }}
              className="underline underline-offset-2 whitespace-nowrap"
            >
              mlx-community/gemma-4
            </a>
            <span>
              {t('settings:mtpUnsupportedDescSuffix', {
                defaultValue:
                  ' to enable Multi-Token Prediction speculative decoding.',
              })}
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button
            size="sm"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto"
          >
            {t('common:ok', { defaultValue: 'OK' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
