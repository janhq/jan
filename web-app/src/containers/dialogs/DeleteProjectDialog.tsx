import { useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface DeleteProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  projectName?: string
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  onConfirm,
  projectName,
}: DeleteProjectDialogProps) {
  const { t } = useTranslation()
  const deleteButtonRef = useRef<HTMLButtonElement>(null)

  const handleConfirm = () => {
    try {
      onConfirm()
      toast.success(
        projectName
          ? t('projects.deleteProjectDialog.successWithName', { projectName })
          : t('projects.deleteProjectDialog.successWithoutName')
      )
      onOpenChange(false)
    } catch (error) {
      toast.error(t('projects.deleteProjectDialog.error'))
      console.error('Delete project error:', error)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirm()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          deleteButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('projects.deleteProjectDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('projects.deleteProjectDialog.description')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="link" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            ref={deleteButtonRef}
            variant="destructive"
            onClick={handleConfirm}
            onKeyDown={handleKeyDown}
            aria-label={t('projects.deleteProjectDialog.ariaLabel', {
              projectName: projectName || t('projects.title').toLowerCase(),
            })}
          >
            {t('projects.deleteProjectDialog.deleteButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
