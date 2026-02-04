<<<<<<< HEAD
﻿import { createFileRoute, useParams } from '@tanstack/react-router'
import { useMemo } from 'react'

import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useThreads } from '@/hooks/useThreads'
=======
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useThreads } from '@/hooks/useThreads'
import { useAssistant } from '@/hooks/useAssistant'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
import { useTranslation } from '@/i18n/react-i18next-compat'

import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import ThreadList from '@/containers/ThreadList'
<<<<<<< HEAD
import DropdownAssistant from '@/containers/DropdownAssistant'

import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { PlatformFeature } from '@/lib/platform/types'
import { IconMessage } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { useSmallScreen } from '@/hooks/useMediaQuery'

export const Route = createFileRoute('/project/$projectId')({
  component: ProjectPage,
})

function ProjectPage() {
  return (
    <PlatformGuard feature={PlatformFeature.PROJECTS}>
      <ProjectPageContent />
    </PlatformGuard>
  )
}

function ProjectPageContent() {
  const { t } = useTranslation()
  const { projectId } = useParams({ from: '/project/$projectId' })
  const { getFolderById } = useThreadManagement()
  const threads = useThreads((state) => state.threads)

  const chatWidth = useInterfaceSettings((state) => state.chatWidth)
  const isSmallScreen = useSmallScreen()
=======
import { AvatarEmoji } from '@/containers/AvatarEmoji'

import { FolderPenIcon, MessageCircle, MoreHorizontal, PencilIcon, Trash2 } from 'lucide-react'
import ProjectFiles from '@/containers/ProjectFiles'
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
  const { t, i18n } = useTranslation()
  const { projectId } = useParams({ from: '/project/$projectId' })
  const { getFolderById, updateFolder } = useThreadManagement()
  const threads = useThreads((state) => state.threads)
  const { assistants } = useAssistant()

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

  // Find the project
  const project = getFolderById(projectId)

<<<<<<< HEAD
=======
  // Find the assigned assistant
  const projectAssistant = useMemo(() => {
    if (!project?.assistantId) return null
    return assistants.find((a) => a.id === project.assistantId) || null
  }, [project?.assistantId, assistants])

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  // Get threads for this project
  const projectThreads = useMemo(() => {
    return Object.values(threads)
      .filter((thread) => thread.metadata?.project?.id === projectId)
      .sort((a, b) => (b.updated || 0) - (a.updated || 0))
  }, [threads, projectId])

<<<<<<< HEAD
=======
  const handleSaveEdit = async (name: string, assistantId?: string) => {
    if (project) {
      await updateFolder(project.id, name, assistantId)
      setEditDialogOpen(false)
    }
  }

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-center">
<<<<<<< HEAD
          <h1 className="text-2xl font-semibold text-main-view-fg mb-2">
            {t('projects.projectNotFound')}
          </h1>
          <p className="text-main-view-fg/70">
=======
          <h1 className="text-2xl font-semibold mb-2">
            {t('projects.projectNotFound')}
          </h1>
          <p className="text-muted-foreground">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            {t('projects.projectNotFoundDesc')}
          </p>
        </div>
      </div>
    )
  }

  return (
<<<<<<< HEAD
    <div className="flex h-full flex-col">
      <HeaderPage>
        <div className="flex items-center justify-between w-full">
          {PlatformFeatures[PlatformFeature.ASSISTANTS] && (
            <DropdownAssistant />
          )}
        </div>
      </HeaderPage>

      <div className="h-full relative flex flex-col justify-between px-4 md:px-8 py-4 overflow-y-auto">
        <div
          className={cn(
            'mx-auto flex h-full flex-col justify-between',
            chatWidth === 'compact' ? 'w-full md:w-4/6' : 'w-full',
            isSmallScreen && 'w-full'
          )}
        >
          <div className="flex h-full flex-col">
            <div className="mb-6 mt-2">
              {projectThreads.length > 0 && (
                <>
                  <h2 className="text-xl font-semibold text-main-view-fg mb-2">
                    {t('projects.conversationsIn', {
                      projectName: project.name,
                    })}
                  </h2>
                  <p className="text-main-view-fg/70">
                    {t('projects.conversationsDescription')}
                  </p>
                </>
              )}
            </div>

            {/* Thread List or Empty State */}
            <div className="mb-0">
              {projectThreads.length > 0 ? (
                <ThreadList
                  threads={projectThreads}
                  variant="project"
                  currentProjectId={projectId}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <IconMessage
                    size={48}
                    className="text-main-view-fg/30 mb-4"
                  />
                  <h3 className="text-lg font-medium text-main-view-fg/60 mb-2">
                    {t('projects.noConversationsIn', {
                      projectName: project.name,
                    })}
                  </h3>
                  <p className="text-main-view-fg/50 text-sm">
                    {t('projects.startNewConversation', {
                      projectName: project.name,
                    })}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* New Chat Input */}
      <div
        className={cn(
          'mx-auto pt-2 pb-3 shrink-0 relative px-2',
          chatWidth === 'compact' ? 'w-full md:w-4/6' : 'w-full',
          isSmallScreen && 'w-full'
        )}
      >
        <ChatInput
          showSpeedToken={false}
          initialMessage={true}
          projectId={projectId}
        />
      </div>
=======
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
            <div className="flex flex-col items-center justify-center pt-6 pb-12 text-center bg-card rounded-xl border mb-6">
              <MessageCircle className="size-8 text-muted-foreground/50 mb-3" />
              <h3 className="text-base font-medium text-foreground mb-1">
                {t('projects.noConversationsIn', { projectName: project.name })}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('projects.startNewConversation', { projectName: project.name })}
              </p>
            </div>
          )}

          {/* Project Settings Card */}
          <div className="rounded-xl border border-border overflow-hidden mb-6 bg-card">
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
                variant="outline"
                size="sm"
                onClick={() => setEditDialogOpen(true)}
              >
                <PencilIcon className="size-3" />
                <span>{t('common:edit')}</span>
              </Button>
            </div>

            {/* Files Section */}
            <ProjectFiles projectId={projectId} lng={i18n.language} />
          </div>
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
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    </div>
  )
}
