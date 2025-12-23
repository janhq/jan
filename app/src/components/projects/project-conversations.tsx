import { MoreHorizontal, Trash2, PencilLine, Loader2, FolderX } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Link, useParams } from '@tanstack/react-router'

import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerSeparator,
  DropDrawerTrigger,
} from '@/components/ui/dropdrawer'
import { ProjectsChatInput } from '@/components/chat-input/projects-chat-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useConversations } from '@/stores/conversation-store'
import { useProjects } from '@/stores/projects-store'
import { useChatSessions } from '@/stores/chat-session-store'

interface ProjectConversationsProps {
  projectId: string
}

interface ConversationWithLatestMessage extends Conversation {
  latestMessage?: string
}

export function ProjectConversations({ projectId }: ProjectConversationsProps) {
  const params = useParams({ strict: false }) as { conversationId?: string }
  const allConversations = useConversations((state) => state.conversations)
  const projects = useProjects((state) => state.projects)
  const currentProject = projects.find((p) => p.id === projectId)
  const getUIMessages = useConversations((state) => state.getUIMessages)
  const deleteConversation = useConversations(
    (state) => state.deleteConversation
  )
  const updateConversation = useConversations(
    (state) => state.updateConversation
  )
  const isSessionBusy = useChatSessions((state) => state.isSessionBusy)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [itemToDelete, setItemToDelete] = useState<Conversation | null>(null)
  const [itemToRename, setItemToRename] = useState<Conversation | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [conversationsWithMessages, setConversationsWithMessages] = useState<
    ConversationWithLatestMessage[]
  >([])

  // Filter conversations for this specific project
  const projectConversations = allConversations.filter(
    (conversation) => conversation.project_id === projectId
  )

  // Fetch latest message for each conversation
  useEffect(() => {
    const fetchLatestMessages = async () => {
      const conversationsWithLatest = await Promise.all(
        projectConversations.map(async (conversation) => {
          try {
            const uiMessages = await getUIMessages(conversation.id)
            const latestUserMessage = uiMessages.pop()

            let latestMessage = 'No messages yet'
            if (latestUserMessage) {
              // Get text from the message parts
              const textPart = latestUserMessage.parts.find(
                (part) => part.type === 'text'
              )
              if (textPart && textPart.type === 'text') {
                latestMessage = textPart.text
              }
            }
            return {
              ...conversation,
              latestMessage,
            }
          } catch (error) {
            console.error(
              `Failed to fetch messages for conversation ${conversation.id}:`,
              error
            )
            return {
              ...conversation,
              latestMessage: 'Failed to load message',
            }
          }
        })
      )
      setConversationsWithMessages(conversationsWithLatest)
    }

    if (projectConversations.length > 0) {
      fetchLatestMessages()
    } else {
      setConversationsWithMessages([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectConversations.length, projectId, getUIMessages])

  const handleDeleteClick = (item: Conversation) => {
    setItemToDelete(item)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!itemToDelete) return

    try {
      await deleteConversation(itemToDelete.id)
      setDeleteDialogOpen(false)
      setItemToDelete(null)
      // If we're currently viewing the deleted conversation, stay on project page
      if (params.conversationId === itemToDelete.id) {
        // You might want to navigate somewhere or just refresh
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error)
    }
  }

  const handleMoveToProject = async (
    conversationId: string,
    projectId: string
  ) => {
    try {
      await updateConversation(conversationId, { project_id: projectId })
    } catch (error) {
      console.error('Failed to move conversation to project:', error)
    }
  }

  const handleRemoveFromProject = async (conversationId: string) => {
    try {
      await updateConversation(conversationId, { project_id: '' })
    } catch (error) {
      console.error('Failed to remove conversation from project:', error)
    }
  }

  const handleRenameClick = (item: Conversation) => {
    setItemToRename(item)
    setNewTitle(item.title)
    setRenameDialogOpen(true)
  }

  const handleConfirmRename = async () => {
    if (!itemToRename || !newTitle.trim()) return

    try {
      const updatedConversation = await updateConversation(itemToRename.id, {
        title: newTitle.trim(),
      })

      // Update the local state to reflect the rename immediately
      setConversationsWithMessages((prev) =>
        prev.map((conv) =>
          conv.id === updatedConversation.id
            ? { ...conv, title: updatedConversation.title }
            : conv
        )
      )

      setRenameDialogOpen(false)
      setItemToRename(null)
      setNewTitle('')
    } catch (error) {
      console.error('Failed to rename conversation:', error)
    }
  }

  const displayConversations =
    conversationsWithMessages.length > 0
      ? conversationsWithMessages
      : projectConversations

  return (
    <div className="w-full h-full overflow-y-auto">
      <div className="space-y-2">
        {displayConversations.map((conversation) => (
          <div
            key={conversation.id}
            className="group flex items-center justify-between rounded-2xl py-3 px-4 bg-muted/50 transition-colors"
          >
            <Link
              to="/threads/$conversationId"
              params={{ conversationId: conversation.id }}
              className="flex-1 min-w-0"
            >
              <h3 className="font-medium text-sm truncate">
                {conversation.title}
              </h3>
              <p className="text-muted-foreground truncate mt-1">
                {(conversation as ConversationWithLatestMessage).latestMessage}
              </p>
            </Link>
            {isSessionBusy(conversation.id) ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground flex-shrink-0 mx-2" />
            ) : (
              <DropDrawer>
                <DropDrawerTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreHorizontal className="text-muted-foreground size-4" />
                  </Button>
                </DropDrawerTrigger>
                <DropDrawerContent className="md:w-56" align="end">
                  <DropDrawerItem onClick={() => handleRenameClick(conversation)}>
                    <div className="flex gap-2 items-center">
                      <PencilLine />
                      <span>Rename</span>
                    </div>
                  </DropDrawerItem>
                  <ProjectsChatInput
                    title="Move to Project"
                    currentProjectId={conversation.project_id}
                    onProjectSelect={(projectId) =>
                      handleMoveToProject(conversation.id, projectId)
                    }
                  />
                  <DropDrawerItem
                    onClick={() => handleRemoveFromProject(conversation.id)}
                  >
                    <div className="flex gap-2 items-center">
                      <FolderX className="size-4 text-muted-foreground flex-shrink-0" />
                      <span className="truncate">
                        Remove from{' '}
                        {(currentProject?.name || 'Project').length > 8
                          ? `${(currentProject?.name || 'Project').slice(0, 8)}...`
                          : currentProject?.name || 'Project'}
                      </span>
                    </div>
                  </DropDrawerItem>
                  <DropDrawerSeparator />
                  <DropDrawerItem
                    variant="destructive"
                    onClick={() => handleDeleteClick(conversation)}
                  >
                    <div className="flex gap-2 items-center">
                      <Trash2 className="text-destructive" />
                      <span>Delete</span>
                    </div>
                  </DropDrawerItem>
                </DropDrawerContent>
              </DropDrawer>
            )}
          </div>
        ))}
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Conversation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-semibold">
                &quot;{itemToDelete?.title}&quot;?
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
              variant="destructive"
              onClick={handleConfirmDelete}
              className="rounded-full"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[425px]" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Input
                id="title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Enter new title"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTitle.trim()) {
                    handleConfirmRename()
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" className="rounded-full">
                Cancel
              </Button>
            </DialogClose>
            <Button
              className="rounded-full"
              onClick={handleConfirmRename}
              disabled={!newTitle.trim()}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
