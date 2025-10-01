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

  // Calculate thread stats for this project
  const { threadCount, starredThreadCount } = useMemo(() => {
    if (!projectId) return { threadCount: 0, starredThreadCount: 0 }

    const projectThreads = Object.values(threads).filter(
      (thread) => thread.metadata?.project?.id === projectId
    )
    const starredCount = projectThreads.filter(
      (thread) => thread.isFavorite
    ).length

    return {
      threadCount: projectThreads.length,
      starredThreadCount: starredCount,
    }
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

  const hasStarredThreads = starredThreadCount > 0
  const hasThreads = threadCount > 0

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
          <DialogDescription className="space-y-2">
            {hasStarredThreads ? (
              <>
                <p className="text-red-600 dark:text-red-400 font-semibold">
                  {t('projects.deleteProjectDialog.starredWarning')}
                </p>
                <p className="font-medium">
                  {t('projects.deleteProjectDialog.permanentDeleteWarning')}
                </p>
              </>
            ) : hasThreads ? (
              <p>
                {t('projects.deleteProjectDialog.permanentDelete')}
              </p>
            ) : (
              <p>
                {t('projects.deleteProjectDialog.deleteEmptyProject', { projectName })}
              </p>
            )}
            {hasThreads && (
              <p className="text-sm text-muted-foreground mt-3">
                {t('projects.deleteProjectDialog.saveThreadsAdvice')}
              </p>
            )}
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
