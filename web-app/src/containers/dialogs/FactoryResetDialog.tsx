import { useRef } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface FactoryResetDialogProps {
  onReset: () => void
  children: React.ReactNode
}

export function FactoryResetDialog({
  onReset,
  children,
}: FactoryResetDialogProps) {
  const { t } = useTranslation()
  const resetButtonRef = useRef<HTMLButtonElement>(null)

  const handleReset = () => {
    onReset()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleReset()
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="sm:max-w-[425px] max-w-[90vw]"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          resetButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('settings:general.factoryResetTitle')}</DialogTitle>
          <DialogDescription>
            {t('settings:general.factoryResetDesc')}
          </DialogDescription>
          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <DialogClose asChild>
              <Button 
                variant="ghost" 
                size="sm" 
                className="hover:no-underline w-full sm:w-auto"
              >
                {t('settings:general.cancel')}
              </Button>
            </DialogClose>
            <DialogClose asChild>
              <Button
                ref={resetButtonRef}
                variant="destructive"
                onClick={handleReset}
                onKeyDown={handleKeyDown}
                size="sm"
                className="w-full sm:w-auto"
                aria-label={t('settings:general.reset')}
              >
                {t('settings:general.reset')}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
