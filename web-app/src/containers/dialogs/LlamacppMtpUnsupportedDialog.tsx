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

interface LlamacppMtpUnsupportedDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelId: string
}

/// Shown when the user flips the upstream-llama `mtp` toggle on while the
/// active llama.cpp model name does not contain "mtp". Mirrors the MLX
/// `MtpUnsupportedDialog` UX (the model itself simply can't speculate via
/// the MTP head — there's nothing for `--spec-type draft-mtp` to attach to).
export function LlamacppMtpUnsupportedDialog({
  open,
  onOpenChange,
  modelId,
}: LlamacppMtpUnsupportedDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] max-w-[90vw]">
        <DialogHeader>
          <DialogTitle className="font-bold">
            {t('settings:llamacppMtpUnsupportedTitle', {
              defaultValue: "MTP isn't available for this model",
            })}
          </DialogTitle>
          <DialogDescription>
            {/* Composed manually instead of via i18n placeholders so the
                inline link to the upstream MTP collection stays a real
                anchor element (the t() return is a plain string). */}
            <span>
              {t('settings:llamacppMtpUnsupportedDescPrefix', {
                defaultValue:
                  "{{modelId}} is not an MTP-capable GGUF. Pick a model from ",
                modelId,
              })}
            </span>
            <a
              href="https://huggingface.co/ggml-org/Qwen3.6-27B-MTP-GGUF"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#1F7CFF' }}
              className="underline underline-offset-2 whitespace-nowrap"
            >
              ggml-org/Qwen3.6-27B-MTP-GGUF
            </a>
            <span> {t('common:or', { defaultValue: 'or' })} </span>
            <a
              href="https://huggingface.co/ggml-org/Qwen3.6-35B-A3B-MTP-GGUF"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#1F7CFF' }}
              className="underline underline-offset-2 whitespace-nowrap"
            >
              ggml-org/Qwen3.6-35B-A3B-MTP-GGUF
            </a>
            <span>
              {t('settings:llamacppMtpUnsupportedDescSuffix', {
                defaultValue:
                  ' to enable Multi-Token Prediction speculative decoding.',
              })}
            </span>
            <span className="mt-2 block">
              {t('settings:llamacppMtpGemmaSupportedPrefix', {
                defaultValue:
                  'Gemma 4 31B and 26B-A4B are also supported — their MTP draft head is downloaded automatically from ',
              })}
            </span>
            <a
              href="https://huggingface.co/am17an/Gemma4-31B-it-GGUF"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#1F7CFF' }}
              className="underline underline-offset-2 whitespace-nowrap"
            >
              am17an/Gemma4-31B-it-GGUF
            </a>
            <span> {t('common:and', { defaultValue: 'and' })} </span>
            <a
              href="https://huggingface.co/AtomicChat/gemma-4-26B-A4B-it-assistant-GGUF"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#1F7CFF' }}
              className="underline underline-offset-2 whitespace-nowrap"
            >
              AtomicChat/gemma-4-26B-A4B-it-assistant-GGUF
            </a>
            <span>
              {t('settings:llamacppMtpGemmaSupportedSuffix', {
                defaultValue: '.',
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
