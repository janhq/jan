import { createFileRoute } from '@tanstack/react-router'
import { useState, useMemo } from 'react'

import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useThreads } from '@/hooks/useThreads'
import { useTranslation } from '@/i18n/react-i18next-compat'

import HeaderPage from '@/containers/HeaderPage'
import ThreadList from '@/containers/ThreadList'
import {
  IconCirclePlus,
  IconPencil,
  IconTrash,
  IconFolder,
  IconChevronDown,
  IconChevronRight,
} from '@tabler/icons-react'
import AddProjectDialog from '@/containers/dialogs/AddProjectDialog'
import { DeleteProjectDialog } from '@/containers/dialogs/DeleteProjectDialog'
import { Button } from '@/components/ui/button'

import { formatDate } from '@/utils/formatDate'

export const Route = createFileRoute('/project/')({
  component: Project,
})

function Project() {
  return <ProjectContent />
}

function ProjectContent() {
  const { t } = useTranslation()
  const { folders, addFolder, updateFolder, deleteFolder, getFolderById } =
    useThreadManagement()
  const threads = useThreads((state) => state.threads)
  const [open, setOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set()
  )

  const handleDelete = (id: string) => {
    setDeletingId(id)
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = () => {
    if (deletingId) {
      deleteFolder(deletingId)
      setDeleteConfirmOpen(false)
      setDeletingId(null)
    }
  }

  const handleSave = (name: string) => {
    if (editingKey) {
      updateFolder(editingKey, name)
    } else {
      addFolder(name)
    }
    setOpen(false)
    setEditingKey(null)
  }

  const formatProjectDate = (timestamp: number) => {
    return formatDate(new Date(timestamp), { includeTime: false })
  }

  // Get threads for a specific project
  const getThreadsForProject = useMemo(() => {
    return (projectId: string) => {
      return Object.values(threads)
        .filter((thread) => thread.metadata?.project?.id === projectId)
        .sort((a, b) => (b.updated || 0) - (a.updated || 0))
    }
  }, [threads])

  const toggleProjectExpansion = (projectId: string) => {
    setExpandedProjects((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(projectId)) {
        newSet.delete(projectId)
      } else {
        newSet.add(projectId)
      }
      return newSet
    })
  }

  return (
    <div className="flex h-full flex-col justify-center">
      <HeaderPage>
        <div className="flex items-center justify-between w-full mr-2">
          <span>{t('projects.title')}</span>
          <Button
            onClick={() => {
              setEditingKey(null)
              setOpen(true)
            }}
            size="sm"
            className="relative z-50"
          >
            <IconCirclePlus size={16} />
            {t('projects.addProject')}
          </Button>
        </div>
      </HeaderPage>
      <div className="h-full overflow-y-auto flex flex-col">
        <div className="p-4 w-full md:w-3/4 mx-auto mt-2">
          {folders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <IconFolder size={48} className="text-main-view-fg/30 mb-4" />
              <h3 className="text-lg font-medium text-main-view-fg/60 mb-2">
                {t('projects.noProjectsYet')}
              </h3>
              <p className="text-main-view-fg/50 text-sm">
                {t('projects.noProjectsYetDesc')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {folders
                .slice()
                .sort((a, b) => b.updated_at - a.updated_at)
                .map((folder) => {
                  const projectThreads = getThreadsForProject(folder.id)
                  const isExpanded = expandedProjects.has(folder.id)

                  return (
                    <div
                      className="bg-main-view-fg/3 py-2 px-4 rounded-lg"
                      key={folder.id}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex items-start gap-3 flex-1">
                          <div className="shrink-0 w-8 h-8 relative flex items-center justify-center bg-main-view-fg/4 rounded-md">
                            <IconFolder
                              size={16}
                              className="text-main-view-fg/50"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="text-base font-medium text-main-view-fg/80 line-clamp-1">
                                {folder.name}
                              </h3>
                              <span className="text-xs bg-main-view-fg/10 text-main-view-fg/60 px-2 py-0.5 rounded-full">
                                {projectThreads.length}{' '}
                                {projectThreads.length === 1
                                  ? t('projects.thread')
                                  : t('projects.threads')}
                              </span>
                            </div>
                            <p className="text-main-view-fg/50 text-xs line-clamp-2 mt-0.5">
                              {t('projects.updated')}{' '}
                              {formatProjectDate(folder.updated_at)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center">
                          {projectThreads.length > 0 && (
                            <button
                              className="size-8 cursor-pointer flex items-center justify-center rounded-md hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out mr-1"
                              title={
                                isExpanded
                                  ? t('projects.collapseThreads')
                                  : t('projects.expandThreads')
                              }
                              onClick={() => toggleProjectExpansion(folder.id)}
                            >
                              {isExpanded ? (
                                <IconChevronDown
                                  size={16}
                                  className="text-main-view-fg/50"
                                />
                              ) : (
                                <IconChevronRight
                                  size={16}
                                  className="text-main-view-fg/50"
                                />
                              )}
                            </button>
                          )}
                          <button
                            className="size-8 cursor-pointer flex items-center justify-center rounded-md hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                            title={t('projects.editProject')}
                            onClick={() => {
                              setEditingKey(folder.id)
                              setOpen(true)
                            }}
                          >
                            <IconPencil
                              size={16}
                              className="text-main-view-fg/50"
                            />
                          </button>
                          <button
                            className="size-8 cursor-pointer flex items-center justify-center rounded-md hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                            title={t('projects.deleteProject')}
                            onClick={() => handleDelete(folder.id)}
                          >
                            <IconTrash
                              size={16}
                              className="text-main-view-fg/50"
                            />
                          </button>
                        </div>
                      </div>

                      {/* Thread List */}
                      {isExpanded && projectThreads.length > 0 && (
                        <div className="mt-3 pl-2">
                          <ThreadList
                            threads={projectThreads}
                            variant="project"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </div>
      <AddProjectDialog
        open={open}
        onOpenChange={setOpen}
        editingKey={editingKey}
        initialData={editingKey ? getFolderById(editingKey) : undefined}
        onSave={handleSave}
      />
      <DeleteProjectDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        onConfirm={confirmDelete}
        projectName={deletingId ? getFolderById(deletingId)?.name : undefined}
      />
    </div>
  )
}
