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

interface Eagle3UnsupportedDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelId: string
}

export function Eagle3UnsupportedDialog({
  open,
  onOpenChange,
  modelId,
}: Eagle3UnsupportedDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] max-w-[90vw]">
        <DialogHeader>
          <DialogTitle className="font-bold">
            {t('settings:eagle3UnsupportedTitle', {
              defaultValue: "EAGLE-3 isn't available for this model",
            })}
          </DialogTitle>
          <DialogDescription>
            {/* Composed manually instead of via i18n placeholders so the
                inline link to the RedHatAI speculator collection stays a
                real anchor element (the t() return is a plain string). */}
            <span>
              {t('settings:eagle3UnsupportedDescPrefix', {
                defaultValue:
                  "{{modelId}} doesn't have a paired EAGLE-3 speculator. Pick a supported Gemma 4 target (31B or 26B-A4B) from ",
                modelId,
              })}
            </span>
            <a
              href="https://huggingface.co/RedHatAI"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#1F7CFF' }}
              className="underline underline-offset-2 whitespace-nowrap"
            >
              RedHatAI
            </a>
            <span>
              {t('settings:eagle3UnsupportedDescSuffix', {
                defaultValue:
                  ' to enable EAGLE-3 speculative decoding.',
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
