import { useState, useRef } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Props for the AddProviderDialog component
 */
interface AddProviderDialogProps {
  /** Callback function called when a new provider is created with the provider name */
  onCreateProvider: (name: string) => void
  /** React children to render as the dialog trigger */
  children: React.ReactNode
}

/**
 * Dialog component for adding a new provider with name input and validation
 * @param onCreateProvider - Callback function to handle provider creation
 * @param children - Trigger element for opening the dialog
 * @returns JSX element containing the provider creation dialog
 */
export function AddProviderDialog({
  onCreateProvider,
  children,
}: AddProviderDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const createButtonRef = useRef<HTMLButtonElement>(null)

  /**
   * Handles the creation of a new provider by validating the name and calling the callback
   */
  const handleCreate = () => {
    if (name.trim()) {
      onCreateProvider(name.trim())
      setName('')
      setIsOpen(false)
    }
  }

  /**
   * Handles dialog cancellation by clearing the input and closing the dialog
   */
  const handleCancel = () => {
    setName('')
    setIsOpen(false)
  }

  /**
   * Handles keyboard events in the input field, triggering creation on Enter key
   * @param e - Keyboard event from the input field
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim()) {
      e.preventDefault()
      handleCreate()
    }
    // Prevent key from being captured by parent components
    e.stopPropagation()
  }

  /**
   * Handles dialog open state changes and clears input when closing
   * @param open - Boolean indicating if the dialog should be open
   */
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) {
      setName('')
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="sm:max-w-[425px] max-w-[90vw]"
        onOpenAutoFocus={(
          /** @param e - Focus event triggered when dialog opens */
          e
        ) => {
          e.preventDefault()
          createButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('provider:addOpenAIProvider')}</DialogTitle>
          <Input
            value={name}
            onChange={(
              /** @param e - Change event from the input field */
              e
            ) => setName(e.target.value)}
            className="mt-2"
            placeholder={t('provider:enterNameForProvider')}
            onKeyDown={handleKeyDown}
          />
          <DialogFooter className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <DialogClose asChild>
              <Button
                variant="link"
                size="sm"
                className="hover:no-underline w-full sm:w-auto"
                onClick={handleCancel}
              >
                {t('common:cancel')}
              </Button>
            </DialogClose>
            <DialogClose asChild>
              <Button
                ref={createButtonRef}
                disabled={!name.trim()}
                onClick={handleCreate}
                className="w-full sm:w-auto"
                size="sm"
                aria-label={t('common:create')}
              >
                {t('common:create')}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
