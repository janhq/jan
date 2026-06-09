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
import { IconTrash } from '@tabler/icons-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import type { KeyboardEvent } from "react"

interface DeleteAllThreadsInProjectDialogProps {
  projectName: string
  threadCount: number
  onDeleteAll: () => void
  onDropdownClose?: () => void
  menuItemLabel?: string
  title?: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
}

export function DeleteAllThreadsInProjectDialog({
  projectName,
  threadCount,
  onDeleteAll,
  onDropdownClose,
  menuItemLabel,
  title,
  description,
  confirmLabel,
  destructive = true,
}: DeleteAllThreadsInProjectDialogProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const menuLabel = menuItemLabel ?? t('common:deleteAll')
  const dialogTitle =
    title ?? t('common:dialogs.deleteAllThreadsInProject.title')
  const dialogDescription =
    description ??
    t('common:dialogs.deleteAllThreadsInProject.description', {
      projectName,
      count: threadCount,
    })
  const confirmActionLabel = confirmLabel ?? t('common:deleteAll')

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
      id: 'delete-all-threads-in-project',
      description: t('common:toast.deleteAllThreads.description'),
    })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter') {
      handleDeleteAll()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <DropdownMenuItem
          variant={destructive ? 'destructive' : 'default'}
          onSelect={(e) => e.preventDefault()}
        >
          <IconTrash size={16} />
          <span>{menuLabel}</span>
        </DropdownMenuItem>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          deleteButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" size="sm" className="w-full sm:w-auto">
                {t('common:cancel')}
              </Button>
            </DialogClose>
            <Button
              ref={deleteButtonRef}
              variant={destructive ? 'destructive' : 'default'}
              onClick={handleDeleteAll}
              onKeyDown={handleKeyDown}
              size="sm"
              className="w-full sm:w-auto"
              aria-label={confirmActionLabel}
            >
              {confirmActionLabel}
            </Button>
          </DialogFooter>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
