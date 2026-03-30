import { useRef, useState } from 'react'
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
import type { FactoryResetOptions } from '@/services/app/types'

interface FactoryResetDialogProps {
  onReset: (options: FactoryResetOptions) => void
  children: React.ReactNode
}

export function FactoryResetDialog({
  onReset,
  children,
}: FactoryResetDialogProps) {
  const { t } = useTranslation()
  const resetButtonRef = useRef<HTMLButtonElement>(null)
  const [keepAppData, setKeepAppData] = useState(true)
  const [keepModelsAndConfigs, setKeepModelsAndConfigs] = useState(true)

  const handleReset = () => {
    onReset({ keepAppData, keepModelsAndConfigs })
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
          <div className="flex flex-col gap-3 pt-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={keepAppData}
                onChange={(e) => setKeepAppData(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer"
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">
                  {t('settings:general.keepAppData')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('settings:general.keepAppDataDesc')}
                </span>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={keepModelsAndConfigs}
                onChange={(e) => setKeepModelsAndConfigs(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer"
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">
                  {t('settings:general.keepModelsAndConfigs')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('settings:general.keepModelsAndConfigsDesc')}
                </span>
              </div>
            </label>
          </div>
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
