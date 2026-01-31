import { createFileRoute, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useThreads } from '@/hooks/useThreads'
import { useAssistant } from '@/hooks/useAssistant'
import { useTranslation } from '@/i18n/react-i18next-compat'

import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import ThreadList from '@/containers/ThreadList'
import { AvatarEmoji } from '@/containers/AvatarEmoji'

import { FileText, FolderPenIcon, MessageCircle, MoreHorizontal, PencilIcon, Trash2 } from 'lucide-react'
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
  const { assistants } = useAssistant()

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  // Find the project
  const project = getFolderById(projectId)

  // Find the assigned assistant
  const projectAssistant = useMemo(() => {
    if (!project?.assistantId) return null
    return assistants.find((a) => a.id === project.assistantId) || null
  }, [project?.assistantId, assistants])

  // Get threads for this project
  const projectThreads = useMemo(() => {
    return Object.values(threads)
      .filter((thread) => thread.metadata?.project?.id === projectId)
      .sort((a, b) => (b.updated || 0) - (a.updated || 0))
  }, [threads, projectId])

  const handleSaveEdit = async (name: string, assistantId?: string) => {
    if (project) {
      await updateFolder(project.id, name, assistantId)
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
    <div className="flex flex-col h-svh w-full">
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

          {/* Project Settings Card */}
          <div className="rounded-xl border border-border overflow-hidden mb-6">
            {/* Assistant Section */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">{t('projects.addProjectDialog.assistant')}</h3>
                {projectAssistant ? (
                  <div className="flex items-center gap-1.5 mt-1">
                    {projectAssistant.avatar && (
                      <AvatarEmoji
                        avatar={projectAssistant.avatar}
                        imageClassName="w-4 h-4 object-contain"
                        textClassName="text-sm"
                      />
                    )}
                    <span className="text-sm text-muted-foreground">{projectAssistant.name}</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('projects.noAssistantAssigned')}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setEditDialogOpen(true)}
              >
                <PencilIcon className="size-4" />
              </Button>
            </div>

            {/* Files Section */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">{t('projects.files')}</h3>
              </div>
              <div className="flex flex-col items-center justify-center py-8 px-4 rounded-lg bg-secondary/30 border border-dashed border-border">
                <FileText className="size-8 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground text-center">
                  {t('projects.filesDescription')}
                </p>
              </div>
            </div>
          </div>

          {/* Conversation Section */}
          {projectThreads.length > 0 && (
            <div className="flex flex-col mb-6">
              <h2 className="text-base font-medium mb-4">
                {t('projects.conversation')}
              </h2>
              <SidebarMenu>
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
              <MessageCircle className="size-8 text-muted-foreground/50 mb-3" />
              <h3 className="text-base font-medium text-foreground mb-1">
                {t('projects.noConversationsIn', { projectName: project.name })}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('projects.startNewConversation', { projectName: project.name })}
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
