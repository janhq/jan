import { useRef, useMemo } from 'react'
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
import { useThreads } from '@/hooks/useThreads'
import { useThreadManagement } from '@/hooks/useThreadManagement'

interface DeleteProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  projectName?: string
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: DeleteProjectDialogProps) {
  const { t } = useTranslation()
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const threads = useThreads((state) => state.threads)
  const { deleteFolderWithThreads } = useThreadManagement()

  const threadCount = useMemo(() => {
    if (!projectId) return 0

    return Object.values(threads).filter(
      (thread) => thread.metadata?.project?.id === projectId
    ).length
  }, [projectId, threads])

  const handleConfirm = async () => {
    if (!projectId) return

    try {
      await deleteFolderWithThreads(projectId)
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

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      await handleConfirm()
    }
  }

  const hasThreads = threadCount > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          deleteButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('projects.deleteProjectDialog.title')}</DialogTitle>
          <DialogDescription>
            {hasThreads ? (
              <p>{t('projects.deleteProjectDialog.permanentDelete')}</p>
            ) : (
              <p>{t('projects.deleteProjectDialog.deleteEmptyProject', { projectName })}</p>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
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
