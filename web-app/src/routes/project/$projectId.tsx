import { createFileRoute, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useThreads } from '@/hooks/useThreads'
import { useTranslation } from '@/i18n/react-i18next-compat'

import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import ThreadList from '@/containers/ThreadList'

import { FolderPenIcon, MessageCircle, MoreHorizontal, Trash2 } from 'lucide-react'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import AddProjectDialog from '@/containers/dialogs/AddProjectDialog'
import { DeleteProjectDialog } from '@/containers/dialogs/DeleteProjectDialog'
import { SidebarMenu } from '@/components/ui/sidebar'

export const Route = createFileRoute('/project/$projectId')({
  component: ProjectPageContent,
})

function ProjectPageContent() {
  const { t } = useTranslation()
  const { projectId } = useParams({ from: '/project/$projectId' })
  const { getFolderById, updateFolder } = useThreadManagement()
  const threads = useThreads((state) => state.threads)

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  // Find the project
  const project = getFolderById(projectId)

  // Get threads for this project
  const projectThreads = useMemo(() => {
    return Object.values(threads)
      .filter((thread) => thread.metadata?.project?.id === projectId)
      .sort((a, b) => (b.updated || 0) - (a.updated || 0))
  }, [threads, projectId])

  const handleSaveEdit = async (name: string) => {
    if (project) {
      await updateFolder(project.id, name)
      setEditDialogOpen(false)
    }
  }

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-2">
            {t('projects.projectNotFound')}
          </h1>
          <p className="text-muted-foreground">
            {t('projects.projectNotFoundDesc')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <HeaderPage>
        <div className="flex items-center justify-between w-full">
          <DropdownModelProvider />
        </div>
      </HeaderPage>

      <div className="h-full relative flex flex-col px-4 md:px-8 py-4 overflow-y-auto">
        <div className="mx-auto w-full md:w-4/5 xl:w-4/6">
          {/* Project Name with Dropdown */}
          <div className="flex items-center justify-between gap-2 mb-4">
            <h1 className="text-2xl font-semibold">
              {project.name}
            </h1>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs">
                  <MoreHorizontal className="size-4" />
                  <span className="sr-only">More options</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditDialogOpen(true)}>
                  <FolderPenIcon className="size-4" />
                  <span>{t('projects.editProject')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="size-4" />
                  <span>{t('projects.deleteProject')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Chat Input */}
          <div className="mb-6">
            <ChatInput
              showSpeedToken={false}
              initialMessage={true}
              projectId={projectId}
            />
          </div>

          {/* Conversation Section */}
          {projectThreads.length > 0 && (
            <div className="flex flex-col">
              <h2 className="text-base font-medium mb-4">
                {t('projects.conversation')}
              </h2>
              <SidebarMenu className='space-y-2'>
                <ThreadList
                  threads={projectThreads}
                  currentProjectId={projectId}
                />
              </SidebarMenu>
            </div>
          )}

          {/* Empty State */}
          {projectThreads.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageCircle
                className="text-muted-foreground size-8 mb-4"
              />
              <h3 className="text-lg font-medium text-foreground mb-1">
                {t('projects.noConversationsIn', {
                  projectName: project.name,
                })}
              </h3>
              <p className="text-muted-foreground/70 text-sm">
                {t('projects.startNewConversation', {
                  projectName: project.name,
                })}
              </p>
            </div>
          )}
        </div>
      </div>

      <AddProjectDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        editingKey={project.id}
        initialData={project}
        onSave={handleSaveEdit}
      />

      <DeleteProjectDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        projectId={project.id}
        projectName={project.name}
      />
    </div>
  )
}
