import { useEffect, useRef, useState } from 'react'
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
import { IconEdit } from '@tabler/icons-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'

interface RenameThreadDialogProps {
  thread: Thread
  plainTitleForRename: string
  onRename: (threadId: string, title: string) => void
  onDropdownClose?: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  withoutTrigger?: boolean
}

export function RenameThreadDialog({
  thread,
  plainTitleForRename,
  onRename,
  onDropdownClose,
  open,
  onOpenChange,
  withoutTrigger,
}: RenameThreadDialogProps) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [internalOpen, setInternalOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isControlled = open !== undefined
  const isOpen = isControlled ? !!open : internalOpen
  const setOpenSafe = (next: boolean) => {
    if (isControlled) {
      onOpenChange?.(next)
    } else {
      setInternalOpen(next)
    }
  }

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 100)
    }
  }, [isOpen])

  const handleOpenChange = (open: boolean) => {
    setOpenSafe(open)
    if (open) {
      setTitle(plainTitleForRename || t('common:newThread'))
    } else {
      onDropdownClose?.()
    }
  }

  const handleRename = () => {
    if (title.trim()) {
      onRename(thread.id, title.trim())
      setOpenSafe(false)
      onDropdownClose?.()
      toast.success(t('common:toast.renameThread.title'), {
        id: 'rename-thread',
        description: t('common:toast.renameThread.description', { title }),
      })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter' && title.trim()) {
      handleRename()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {!withoutTrigger && (
        <DialogTrigger asChild>
          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
            <IconEdit />
            <span>{t('common:rename')}</span>
          </DropdownMenuItem>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('common:threadTitle')}</DialogTitle>
          <Input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-2"
            onKeyDown={handleKeyDown}
            placeholder={t('common:threadTitle')}
            aria-label={t('common:threadTitle')}
          />
          <DialogFooter className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" size="sm" className="w-full sm:w-auto">
                {t('common:cancel')}
              </Button>
            </DialogClose>
            <Button
              disabled={!title.trim()}
              onClick={handleRename}
              size="sm"
              className="w-full sm:w-auto"
            >
              {t('common:rename')}
            </Button>
          </DialogFooter>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
