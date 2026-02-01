import { useState, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
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
import { IconTrash } from '@tabler/icons-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { route } from '@/constants/routes'

interface DeleteAllThreadsDialogProps {
  onDeleteAll: () => void
  onDropdownClose?: () => void
}

export function DeleteAllThreadsDialog({
  onDeleteAll,
  onDropdownClose,
}: DeleteAllThreadsDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open && onDropdownClose) {
      onDropdownClose()
    }
  }

  const handleDeleteAll = () => {
    onDeleteAll()
    setIsOpen(false)
    if (onDropdownClose) onDropdownClose()
    toast.success(t('common:toast.deleteAllThreads.title'), {
      id: 'delete-all-threads',
      description: t('common:toast.deleteAllThreads.description'),
    })
    setTimeout(() => {
      navigate({ to: route.home })
    }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleDeleteAll()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
          <IconTrash size={16} />
          <span>{t('common:deleteAll')}</span>
        </DropdownMenuItem>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          deleteButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('common:dialogs.deleteAllThreads.title')}
          </DialogTitle>
          <DialogDescription>
            {t('common:dialogs.deleteAllThreads.description')}
          </DialogDescription>
          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" size="sm" className="w-full sm:w-auto">
                {t('common:cancel')}
              </Button>
            </DialogClose>
            <Button
              ref={deleteButtonRef}
              variant="destructive"
              onClick={handleDeleteAll}
              onKeyDown={handleKeyDown}
              size="sm"
              className="w-full sm:w-auto"
              aria-label={t('common:deleteAll')}
            >
              {t('common:deleteAll')}
            </Button>
          </DialogFooter>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
