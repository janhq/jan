/* eslint-disable react-hooks/refs */
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'
import ChatInput from '@/components/chat-input'
import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { NavHeader } from '@/components/sidebar/nav-header'
import { useChat } from '@/hooks/use-chat'
import { janProvider } from '@/lib/api-client'
import { EditProject } from '@/components/projects/edit-project'
import { ManageInstructions } from '@/components/projects/manage-instructions'

import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'

import {
  MessageCircleMore,
  Plus,
  PencilIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  SparklesIcon,
} from 'lucide-react'
import { useModels } from '@/stores/models-store'
import { useEffect, useRef, useState } from 'react'
import { useProjects } from '@/stores/projects-store'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerTrigger,
  DropDrawerSeparator,
} from '@/components/ui/dropdrawer'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { ProjectConversations } from '@/components/projects/project-conversations'
import { useConversations } from '@/stores/conversation-store'
import { CHAT_STATUS } from '@/constants'

function ProjectPageContent() {
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const projectId = params.projectId as string | undefined
  const selectedModel = useModels((state) => state.selectedModel)
  const getProject = useProjects((state) => state.getProject)
  const deleteProject = useProjects((state) => state.deleteProject)
  const [project, setProject] = useState<Project | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isManageInstructionsOpen, setIsManageInstructionsOpen] =
    useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const reasoningContainerRef = useRef<HTMLDivElement>(null)
  const allConversations = useConversations((state) => state.conversations)

  const projectConversations = allConversations.filter(
    (conversation) => conversation.project_id === projectId
  )

  const handleOpenEditDialog = () => {
    setIsEditDialogOpen(true)
  }

  const handleOpenManageInstructions = () => {
    setIsManageInstructionsOpen(true)
  }

  const handleDeleteClick = () => {
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!projectId) return

    try {
      await deleteProject(projectId)
      setDeleteDialogOpen(false)
      // Redirect to home after deletion
      navigate({ to: '/' })
    } catch (error) {
      console.error('Failed to delete project:', error)
    }
  }

  const handleProjectUpdated = () => {
    if (projectId) {
      getProject(projectId)
        .then((projectData) => {
          setProject(projectData)
        })
        .catch((error) => {
          console.error('Failed to reload project:', error)
        })
    }
  }

  const provider = janProvider()

  const { status, sendMessage } = useChat(provider(selectedModel?.id), {
    onFinish: () => {
      // After finishing a message
    },
  })

  const handleSubmit = (message?: PromptInputMessage) => {
    if (message)
      sendMessage({
        text: message.text || 'Sent with attachments',
        files: message.files,
      })
  }

  useEffect(() => {
    if (projectId) {
      getProject(projectId)
        .then((projectData) => {
          setProject(projectData)
        })
        .catch((error) => {
          console.error('Failed to load project:', error)
        })
    }
  }, [projectId, getProject])

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (status === CHAT_STATUS.STREAMING && reasoningContainerRef.current) {
      reasoningContainerRef.current.scrollTop =
        reasoningContainerRef.current.scrollHeight
    }
  }, [status, reasoningContainerRef.current?.textContent])

  return (
    <>
      <AppSidebar />
      <SidebarInset>
        <NavHeader />
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-20 mt-2 w-full px-4 md:px-10 py-2 overflow-y-auto h-[calc(100vh-56px)]">
          <div className="col-span-full xl:col-span-8 flex flex-col h-full">
            <div className="size-full mx-auto flex flex-col">
              <div>
                <div className="flex justify-between items-center">
                  <h1 className="text-xl font-semibold font-studio">
                    {project?.name}
                  </h1>
                  <DropDrawer>
                    <DropDrawerTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreHorizontalIcon />
                      </Button>
                    </DropDrawerTrigger>
                    <DropDrawerContent className="text-left">
                      <DropDrawerItem onClick={handleOpenEditDialog}>
                        <div className="flex items-center gap-2">
                          <PencilIcon />
                          <span>Edit project</span>
                        </div>
                      </DropDrawerItem>
                      <DropDrawerItem onClick={handleOpenManageInstructions}>
                        <div className="flex items-center gap-2">
                          <SparklesIcon />
                          <span>Manage instructions</span>
                        </div>
                      </DropDrawerItem>
                      <DropDrawerSeparator />
                      <DropDrawerItem
                        variant="destructive"
                        onClick={handleDeleteClick}
                      >
                        <div className="flex items-center gap-2">
                          <Trash2Icon className="text-destructive" />
                          <span>Delete project</span>
                        </div>
                      </DropDrawerItem>
                    </DropDrawerContent>
                  </DropDrawer>
                </div>
                {/* Enable this when we have desc project */}
                {/* <p className="mt-2 text-muted-foreground">
                  A short description about the project goes here
                </p> */}
                <div className="py-4 mx-auto w-full">
                  <ChatInput
                    submit={handleSubmit}
                    status={status}
                    initialConversation
                    projectId={project?.id}
                  />
                </div>
              </div>
              <Separator className="my-4" />
              <div className="flex-1 flex pb-4 min-h-0">
                <div className="size-full flex flex-col gap-4">
                  <span className="text-base font-studio font-semibold mt-4 inline-block shrink-0">
                    Conversation
                  </span>

                  {projectConversations.length === 0 ? (
                    <div
                      className={cn(
                        'relative rounded-2xl flex-1 overflow-y-auto bg-muted/50 flex items-center justify-center text-center'
                      )}
                    >
                      <div className="px-8 w-full md:w-1/2 mx-auto">
                        <MessageCircleMore className="text-muted-foreground size-6 mx-auto mb-2" />
                        <p className="text-base mb-2">No conversations yet</p>
                        <p className="text-sm text-muted-foreground">
                          Start a chat to keep conversations organized and
                          re-use project knowledge.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className={cn('relative overflow-hidden min-h-0')}>
                      <ProjectConversations projectId={project?.id || ''} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="size-full flex-col pb-4 hidden xl:flex col-span-1 xl:col-span-4">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold inline-block">
                  Instructions
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={handleOpenManageInstructions}
                >
                  {project?.instruction ? (
                    <>
                      <PencilIcon />
                      <span>Edit</span>
                    </>
                  ) : (
                    <>
                      <Plus />
                      <span>Setup</span>
                    </>
                  )}
                </Button>
              </div>
              {project?.instruction ? (
                <p className="text-sm text-muted-foreground line-clamp-3 mt-3">
                  {project.instruction}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground line-clamp-3 mt-3">
                  Customize tone and style of response
                </p>
              )}
            </div>

            {/* Temporary disabled till we have files */}
            {/* <Separator className="my-6" /> */}
            {/* <div className="h-full flex flex-col">
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold inline-block">
                  Files
                </span>
                <Button variant="outline" size="sm" className="rounded-full">
                  <Upload className="text-muted-foreground" />
                  <span>Upload</span>
                </Button>
              </div>
              <div className="mt-3 h-full bg-muted/50 rounded-2xl flex items-center justify-center text-center px-4 py-6 text-sm ">
                <div className="px-8 w-full ">
                  <FilesIcon className="text-muted-foreground size-6 mx-auto mb-2" />
                  <p className="text-base mb-2">Add files to this project</p>
                  <p className="text-sm text-muted-foreground">
                    Upload documents that provide Jan with context for more
                    accurate answers
                  </p>
                </div>
              </div>
            </div> */}
          </div>
        </div>
      </SidebarInset>

      {/* Edit Project Dialog */}
      <EditProject
        open={isEditDialogOpen}
        project={project}
        onSuccess={handleProjectUpdated}
        onOpenChange={setIsEditDialogOpen}
      />

      {/* Manage Instructions Dialog */}
      <ManageInstructions
        open={isManageInstructionsOpen}
        project={project}
        onSuccess={handleProjectUpdated}
        onOpenChange={setIsManageInstructionsOpen}
      />

      {/* Delete Project Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-semibold">
                &quot;{project?.name}&quot;?
              </span>
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="rounded-full">
                Cancel
              </Button>
            </DialogClose>
            <Button
              className="rounded-full"
              variant="destructive"
              onClick={handleConfirmDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ProjectPage() {
  return (
    <SidebarProvider>
      <ProjectPageContent />
    </SidebarProvider>
  )
}

export const Route = createFileRoute('/projects/$projectId')({
  component: ProjectPage,
})
