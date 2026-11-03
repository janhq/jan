import { isTemporaryChatSearch } from '@/constants/chat'
import { createFileRoute, useLocation, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useThreads } from '@/hooks/useThreads'
import { useAssistant } from '@/hooks/useAssistant'
import { useTranslation } from '@/i18n/react-i18next-compat'

import ChatInput from '@/containers/ChatInput'
import { useModelProvider } from '@/hooks/useModelProvider'
import HeaderPage from '@/containers/HeaderPage'
import ThreadList from '@/containers/ThreadList'
import { AvatarEmoji } from '@/containers/AvatarEmoji'

import { FolderPenIcon, MessageCircle, MoreHorizontal, PencilIcon, Trash2 } from 'lucide-react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { DraftWorkspacePill } from '@/containers/DraftWorkspacePill'
import { toast } from 'sonner'
import {
  defaultConversationCapabilities,
  isConversationFolderPath,
  type ConversationCapabilitiesV1,
} from '@/lib/conversationCapabilities'
import ProjectFiles from '@/containers/ProjectFiles'
import { ConversationHeaderTitle } from '@/containers/ConversationHeaderTitle'
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
import { DeleteAllThreadsInProjectDialog } from '@/containers/dialogs/DeleteAllThreadsInProjectDialog'
import { SidebarMenu } from '@/components/ui/sidebar'

export const Route = createFileRoute('/project/$projectId')({
  component: ProjectPageContent,
})

function ProjectPageContent() {
  const { t, i18n } = useTranslation()
  const { selectedModel } = useModelProvider()
  const { projectId } = useParams({ from: '/project/$projectId' })
  const { getFolderById, updateFolder } = useThreadManagement()
  const threads = useThreads((state) => state.threads)
  const deleteAllThreadsByProject = useThreads((state) => state.deleteAllThreadsByProject)
  const setCurrentThreadId = useThreads((state) => state.setCurrentThreadId)
  // Like the home route: the project landing composes a NEW conversation, so
  // no previous thread stays current here (it would briefly target the
  // composer's permissions shield at the prior thread).
  useEffect(() => {
    setCurrentThreadId(undefined)
  }, [setCurrentThreadId])
  const { assistants } = useAssistant()

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const serviceHub = useServiceHub()

  // Draft consent for the NEXT persistent chat in this project; applied only
  // through the strict setter after creation (prepareThreadCreation). A Jan
  // project grants no filesystem access by itself.
  //
  // Keyed by projectId with a SYNCHRONOUS render-phase reset: navigating
  // project A -> B keeps this component mounted, and an effect-based reset
  // would leave one committed render in which A's elevated draft could be
  // sent as B's first-chat grant. The render-phase state adjustment re-renders
  // before anything can be clicked.
  const [scopeDraftState, setScopeDraftState] = useState<{
    forProject: string
    draft: ConversationCapabilitiesV1
  }>(() => ({ forProject: projectId, draft: defaultConversationCapabilities() }))
  if (scopeDraftState.forProject !== projectId) {
    setScopeDraftState({
      forProject: projectId,
      draft: defaultConversationCapabilities(),
    })
  }
  const scopeDraft =
    scopeDraftState.forProject === projectId
      ? scopeDraftState.draft
      : defaultConversationCapabilities()
  const setScopeDraft = useCallback(
    (next: ConversationCapabilitiesV1) =>
      setScopeDraftState({ forProject: projectId, draft: next }),
    [projectId]
  )
  const scopeDraftElevated =
    scopeDraft.shellNetwork ||
    scopeDraft.memoryWrite ||
    scopeDraft.folderScope !== null
  // Single flow: every NEW conversation from a project is an ordinary Chat
  // thread; a Jan project grants no filesystem access by itself and elevated
  // capability only comes from the explicit consent draft below.
  const modelSupportsTools =
    selectedModel?.capabilities?.includes('tools') ?? false
  const searchStr = useLocation({ select: (location) => location.searchStr })
  const isTemporaryChat = isTemporaryChatSearch(searchStr)
  const chatScopeAvailable = modelSupportsTools && !isTemporaryChat
  // Truthful unsupported reason; ordinary direct chat is never refused.
  // Temporary chats are left by starting a regular chat, not by switching
  // models, so the kept-draft note uses a mode-specific key.
  const pendingKeptKey = isTemporaryChat
    ? 'common:conversationScope.pendingKeptTemporary'
    : 'common:conversationScope.pendingKept'
  const pendingKeptNote = scopeDraftElevated ? ` ${t(pendingKeptKey)}` : ''
  const scopeUnsupportedReason = isTemporaryChat
    ? t('common:conversationScope.temporaryPermissions') + pendingKeptNote
    : selectedModel && !modelSupportsTools
      ? t('common:conversationScope.unsupported') + pendingKeptNote
      : null
  const pickScopeFolder = useCallback(async () => {
    const picked = await serviceHub.dialog().open({ directory: true })
    return typeof picked === 'string' ? picked : null
  }, [serviceHub])
  const attachScopeFolder = useCallback(async () => {
    const picked = await pickScopeFolder()
    if (picked === null) return
    if (!isConversationFolderPath(picked)) {
      toast.error(t('common:conversationScope.invalidFolder'))
      return
    }
    // A newly chosen folder starts read-only; writing is a separate switch.
    setScopeDraft({ ...scopeDraft, folderScope: { path: picked, access: 'read' } })
  }, [pickScopeFolder, scopeDraft, setScopeDraft, t])
  const prepareThreadCreation = useCallback(() => {
    const snapshot = scopeDraft
    return async (threadId: string) => {
      await useThreads.getState().setConversationCapabilities(threadId, snapshot)
      return true
    }
  }, [scopeDraft])

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

  const handleDeleteAllThreads = () => deleteAllThreadsByProject(projectId)

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
          <ConversationHeaderTitle project={project} />
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
              pendingSkillFolder={scopeDraft.folderScope?.path ?? null}
              projectId={projectId}
              projectAssistantId={project.assistantId}
              supportsAssistants={true}
              prepareThreadCreation={
                chatScopeAvailable && scopeDraftElevated
                  ? prepareThreadCreation
                  : undefined
              }
            />
            {chatScopeAvailable && (
              <DraftWorkspacePill
                value={scopeDraft}
                onChange={setScopeDraft}
                onPickFolder={() => void attachScopeFolder()}
                showWhenEmpty
              />
            )}
            {/* Persistent live region (see home route): stays mounted, inner
                text changes, no duplicate live attributes. */}
            <div role="status" aria-live="polite" data-testid="project-scope-status">
              {scopeUnsupportedReason && (
                <p
                  className="pt-2 text-xs leading-5 text-muted-foreground"
                  data-testid="project-scope-unsupported"
                >
                  {scopeUnsupportedReason}
                </p>
              )}
            </div>
          </div>

          {/* Conversation Section */}
          {projectThreads.length > 0 && (
            <div className="flex flex-col mb-6">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h2 className="text-base font-medium">
                  {t('projects.conversation')}
                </h2>
                <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs">
                      <MoreHorizontal className="size-4" />
                      <span className="sr-only">More options</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="start">
                    <DeleteAllThreadsInProjectDialog
                      projectName={project.name}
                      threadCount={projectThreads.length}
                      onDeleteAll={handleDeleteAllThreads}
                      onDropdownClose={() => setDropdownOpen(false)}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
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
    </div>
  )
}
