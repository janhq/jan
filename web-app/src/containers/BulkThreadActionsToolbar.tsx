/**
 * @description Floating toolbar for bulk thread operations
 * @module containers/BulkThreadActionsToolbar
 * @since 1.0.0
 */

import { useState, useCallback } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useThreadSelection } from '@/hooks/useThreadSelection'
import { useThreads } from '@/hooks/useThreads'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { Button } from '@/components/ui/button'
import {
  IconTrash,
  IconStar,
  IconStarFilled,
  IconFolder,
  IconX,
} from '@tabler/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BulkThreadActionsDialog } from '@/containers/dialogs/BulkThreadActionsDialog'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { ProjectIcon } from '@/components/ProjectIcon'

interface BulkThreadActionsToolbarProps {
  className?: string
}

export function BulkThreadActionsToolbar({
  className,
}: BulkThreadActionsToolbarProps) {
  const { t } = useTranslation()
  const {
    getSelectedCount,
    getSelectedThreadIds,
    clearSelection,
    isSelectionMode,
  } = useThreadSelection()
  const { threads, deleteThread, toggleFavorite, updateThread } = useThreads()
  const { folders, getFolderById } = useThreadManagement()
  const projectsEnabled = PlatformFeatures[PlatformFeature.PROJECTS]

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogAction, setDialogAction] = useState<'delete' | 'unstar'>(
    'delete'
  )

  const selectedCount = getSelectedCount()
  const selectedIds = getSelectedThreadIds()

  // Check if all selected threads are favorited
  const allSelectedFavorited = selectedIds.every(
    (id: string) => threads[id]?.isFavorite
  )

  // Get available projects (folders)
  const availableProjects = folders
    .filter((f: any) => f.id)
    .sort((a: any, b: any) => b.updated_at - a.updated_at)

  const handleDelete = useCallback(() => {
    setDialogAction('delete')
    setDialogOpen(true)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    const idsToDelete = getSelectedThreadIds()

    try {
      // Batch delete threads
      await Promise.all(idsToDelete.map((id: string) => deleteThread(id)))

      toast.success(
        t('common:toast.bulkDeleteThreads.title', {
          count: idsToDelete.length,
        }),
        {
          description: t('common:toast.bulkDeleteThreads.description', {
            count: idsToDelete.length,
            defaultValue: `Successfully deleted ${idsToDelete.length} thread${idsToDelete.length > 1 ? 's' : ''}`,
          }),
        }
      )

      clearSelection()
    } catch (error) {
      console.error('Bulk delete failed:', error)
      toast.error(
        t('common:toast.bulkDeleteThreads.error', {
          defaultValue: 'Failed to delete threads',
        }),
        {
          description: error instanceof Error ? error.message : String(error),
        }
      )
    }
  }, [getSelectedThreadIds, deleteThread, clearSelection, t])

  const handleToggleFavorite = useCallback(async () => {
    const idsToToggle = getSelectedThreadIds()

    if (allSelectedFavorited) {
      // Show confirmation for unfavoriting
      setDialogAction('unstar')
      setDialogOpen(true)
    } else {
      // Directly star threads
      try {
        await Promise.all(idsToToggle.map((id: string) => toggleFavorite(id)))

        toast.success(
          t('common:toast.bulkStarThreads.title', {
            count: idsToToggle.length,
          }),
          {
            description: t('common:toast.bulkStarThreads.description', {
              count: idsToToggle.length,
              defaultValue: `Successfully starred ${idsToToggle.length} thread${idsToToggle.length > 1 ? 's' : ''}`,
            }),
          }
        )

        clearSelection()
      } catch (error) {
        console.error('Bulk star failed:', error)
        toast.error(
          t('common:toast.bulkStarThreads.error', {
            defaultValue: 'Failed to star threads',
          }),
          {
            description: error instanceof Error ? error.message : String(error),
          }
        )
      }
    }
  }, [
    getSelectedThreadIds,
    allSelectedFavorited,
    toggleFavorite,
    clearSelection,
    t,
  ])

  const handleConfirmUnstar = useCallback(async () => {
    const idsToToggle = getSelectedThreadIds()

    try {
      await Promise.all(idsToToggle.map((id: string) => toggleFavorite(id)))

      toast.success(
        t('common:toast.bulkUnstarThreads.title', {
          count: idsToToggle.length,
        }),
        {
          description: t('common:toast.bulkUnstarThreads.description', {
            count: idsToToggle.length,
            defaultValue: `Successfully removed ${idsToToggle.length} thread${idsToToggle.length > 1 ? 's' : ''} from favorites`,
          }),
        }
      )

      clearSelection()
    } catch (error) {
      console.error('Bulk unstar failed:', error)
      toast.error(
        t('common:toast.bulkUnstarThreads.error', {
          defaultValue: 'Failed to unstar threads',
        }),
        {
          description: error instanceof Error ? error.message : String(error),
        }
      )
    }
  }, [getSelectedThreadIds, toggleFavorite, clearSelection, t])

  const handleAssignToProject = useCallback(
    async (projectId: string) => {
      const idsToAssign = getSelectedThreadIds()
      const project = getFolderById(projectId)

      if (!project) return

      try {
        const projectMetadata = {
          id: project.id,
          name: project.name,
          updated_at: project.updated_at,
        }

        await Promise.all(
          idsToAssign.map((id: string) =>
            updateThread(id, {
              metadata: {
                ...threads[id]?.metadata,
                project: projectMetadata,
              },
            })
          )
        )

        toast.success(
          t('common:toast.bulkAssignProject.title', {
            count: idsToAssign.length,
          }),
          {
            description: t('common:toast.bulkAssignProject.description', {
              count: idsToAssign.length,
              projectName: project.name,
              defaultValue: `Successfully assigned ${idsToAssign.length} thread${idsToAssign.length > 1 ? 's' : ''} to "${project.name}"`,
            }),
          }
        )

        clearSelection()
      } catch (error) {
        console.error('Bulk assign to project failed:', error)
        toast.error(
          t('common:toast.bulkAssignProject.error', {
            defaultValue: 'Failed to assign threads to project',
          }),
          {
            description: error instanceof Error ? error.message : String(error),
          }
        )
      }
    },
    [
      getSelectedThreadIds,
      getFolderById,
      updateThread,
      threads,
      clearSelection,
      t,
    ]
  )

  if (!isSelectionMode || selectedCount === 0) {
    return null
  }

  return (
    <>
      <div
        className={cn(
          'fixed bottom-6 left-1/2 -translate-x-1/2 z-50',
          'bg-left-panel-bg/95 backdrop-blur-lg border border-left-panel-fg/20',
          'rounded-lg shadow-lg px-4 py-3',
          'flex items-center gap-3',
          'animate-in slide-in-from-bottom-5 duration-300',
          className
        )}
      >
        {/* Selection Count */}
        <div className="flex items-center gap-2 px-2 border-r border-left-panel-fg/20">
          <span className="text-sm font-medium text-left-panel-fg">
            {selectedCount} {t('common:selected', { defaultValue: 'selected' })}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Star/Unstar */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleFavorite}
            className="gap-2"
            title={allSelectedFavorited ? t('common:unstar') : t('common:star')}
          >
            {allSelectedFavorited ? (
              <>
                <IconStarFilled size={16} className="text-left-panel-fg/70" />
                <span className="hidden sm:inline">{t('common:unstar')}</span>
              </>
            ) : (
              <>
                <IconStar size={16} className="text-left-panel-fg/70" />
                <span className="hidden sm:inline">{t('common:star')}</span>
              </>
            )}
          </Button>

          {/* Assign to Project */}
          {projectsEnabled && availableProjects.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <IconFolder size={16} className="text-left-panel-fg/70" />
                  <span className="hidden sm:inline">
                    {t('common:projects.addToProject')}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="center"
                className="max-h-60 min-w-48 overflow-y-auto"
              >
                {availableProjects.map((project: any) => (
                  <DropdownMenuItem
                    key={project.id}
                    onClick={() => handleAssignToProject(project.id)}
                  >
                    <ProjectIcon
                      icon={project.icon}
                      color={project.color}
                      size="sm"
                      className="shrink-0"
                    />
                    <span className="truncate max-w-[200px]">
                      {project.name}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Delete */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="gap-2 text-destructive hover:text-destructive"
            title={t('common:delete')}
          >
            <IconTrash size={16} />
            <span className="hidden sm:inline">{t('common:delete')}</span>
          </Button>

          {/* Cancel Selection */}
          <div className="border-l border-left-panel-fg/20 pl-2 ml-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              className="gap-2"
              title={t('common:cancel')}
            >
              <IconX size={16} className="text-left-panel-fg/70" />
            </Button>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <BulkThreadActionsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        action={dialogAction}
        threadCount={selectedCount}
        onConfirm={
          dialogAction === 'delete' ? handleConfirmDelete : handleConfirmUnstar
        }
      />
    </>
  )
}
