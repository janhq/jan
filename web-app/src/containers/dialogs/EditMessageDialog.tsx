import { useState, useEffect, useRef } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { IconPencil } from '@tabler/icons-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface EditMessageDialogProps {
  message: string
  onSave: (message: string) => void
  triggerElement?: React.ReactNode
}

export function EditMessageDialog({
  message,
  onSave,
  triggerElement,
}: EditMessageDialogProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState(message)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setDraft(message)
  }, [message])

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus()
        textareaRef.current?.select()
      }, 100)
    }
  }, [isOpen])

  const handleSave = () => {
    if (draft !== message && draft.trim()) {
      onSave(draft)
      setIsOpen(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSave()
    }
  }

  const defaultTrigger = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="flex outline-0 items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative">
          <IconPencil size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{t('edit')}</p>
      </TooltipContent>
    </Tooltip>
  )

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger>{triggerElement || defaultTrigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('common:dialogs.editMessage.title')}</DialogTitle>
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="mt-2 resize-none w-full min-h-24"
            onKeyDown={handleKeyDown}
            placeholder={t('common:dialogs.editMessage.title')}
            aria-label={t('common:dialogs.editMessage.title')}
          />
          <DialogFooter className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <DialogClose asChild>
              <Button variant="link" size="sm" className="w-full sm:w-auto">
                {t('common:cancel')}
              </Button>
            </DialogClose>
            <Button
              disabled={draft === message || !draft.trim()}
              onClick={handleSave}
              size="sm"
              className="w-full sm:w-auto"
            >
              {t('common:save')}
            </Button>
          </DialogFooter>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
