import { MoreHorizontal, Trash2, PencilLine, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'

import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerSeparator,
  DropDrawerTrigger,
} from '@/components/ui/dropdrawer'
import { ProjectsChatInput } from '@/components/chat-input/projects-chat-input'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { useConversations } from '@/stores/conversation-store'
import { useChatSessions, isSessionBusy } from '@/stores/chat-session-store'

export function NavChats() {
  const { isMobile, setOpenMobile } = useSidebar()
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { conversationId?: string }
  const allConversations = useConversations((state) => state.conversations)
  const getConversations = useConversations((state) => state.getConversations)
  const deleteConversation = useConversations(
    (state) => state.deleteConversation
  )
  const deleteAllConversations = useConversations(
    (state) => state.deleteAllConversations
  )
  const updateConversation = useConversations(
    (state) => state.updateConversation
  )
  const sessions = useChatSessions((state) => state.sessions)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [itemToDelete, setItemToDelete] = useState<Conversation | null>(null)
  const [itemToRename, setItemToRename] = useState<Conversation | null>(null)
  const [newTitle, setNewTitle] = useState('')

  // Filter conversations to only show those without a project_id
  const conversations = allConversations.filter(
    (conversation) => !conversation.project_id
  )

  useEffect(() => {
    getConversations()
  }, [getConversations])

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
      // If we're currently viewing the deleted conversation, redirect to home
      if (params.conversationId === itemToDelete.id) {
        navigate({ to: '/' })
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error)
    }
  }

  const handleDeleteAllClick = () => {
    setDeleteAllDialogOpen(true)
  }

  const handleConfirmDeleteAll = async () => {
    try {
      // Delete all conversations
      await deleteAllConversations()
      setDeleteAllDialogOpen(false)
      // Redirect to home after deleting all
      navigate({ to: '/' })
    } catch (error) {
      console.error('Failed to delete all conversations:', error)
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

  const handleRenameClick = (item: Conversation) => {
    setItemToRename(item)
    setNewTitle(item.title)
    setRenameDialogOpen(true)
  }

  const handleConfirmRename = async () => {
    if (!itemToRename || !newTitle.trim()) return

    try {
      await updateConversation(itemToRename.id, { title: newTitle.trim() })
      setRenameDialogOpen(false)
      setItemToRename(null)
      setNewTitle('')
    } catch (error) {
      console.error('Failed to rename conversation:', error)
    }
  }

  if (conversations.length === 0) {
    return null
  }

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="text-muted-foreground  flex w-full items-center justify-between pr-0">
          Chats
          <DropDrawer>
            <DropDrawerTrigger asChild>
              <Button variant="ghost" className="size-5 mr-0.5">
                <MoreHorizontal className="text-muted-foreground" />
              </Button>
            </DropDrawerTrigger>
            <DropDrawerContent
              className="md:w-40"
              side={isMobile ? 'bottom' : 'right'}
              align={isMobile ? 'end' : 'start'}
            >
              <DropDrawerItem
                variant="destructive"
                onClick={handleDeleteAllClick}
              >
                <div className="flex gap-2 items-center justify-center">
                  <Trash2 className="text-destructive" />
                  <span>Delete All</span>
                </div>
              </DropDrawerItem>
            </DropDrawerContent>
          </DropDrawer>
        </SidebarGroupLabel>
        <SidebarMenu>
          {conversations.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                asChild
                isActive={params.conversationId === item.id}
              >
                <Link
                  to="/threads/$conversationId"
                  params={{ conversationId: item.id }}
                  title={item.title}
                  onClick={() => {
                    if (isMobile) {
                      setOpenMobile(false)
                    }
                  }}
                >
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
              {isSessionBusy(sessions[item.id]) ? (
                <SidebarMenuAction>
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </SidebarMenuAction>
              ) : (
                <DropDrawer>
                  <DropDrawerTrigger asChild>
                    <SidebarMenuAction showOnHover>
                      <MoreHorizontal className="text-muted-foreground" />
                      <span className="sr-only">More</span>
                    </SidebarMenuAction>
                  </DropDrawerTrigger>
                  <DropDrawerContent
                    className="md:w-56"
                    side={isMobile ? 'bottom' : 'right'}
                    align={isMobile ? 'end' : 'start'}
                  >
                    <DropDrawerItem onClick={() => handleRenameClick(item)}>
                      <div className="flex gap-2 items-center justify-center">
                        <PencilLine />
                        <span>Rename</span>
                      </div>
                    </DropDrawerItem>
                    <ProjectsChatInput
                      title="Move to Project"
                      currentProjectId={item.project_id}
                      onProjectSelect={(projectId) =>
                        handleMoveToProject(item.id, projectId)
                      }
                    />
                    <DropDrawerSeparator />
                    <DropDrawerItem
                      variant="destructive"
                      onClick={() => handleDeleteClick(item)}
                    >
                      <div className="flex gap-2 items-center justify-center">
                        <Trash2 className="text-destructive" />
                        <span>Delete</span>
                      </div>
                    </DropDrawerItem>
                  </DropDrawerContent>
                </DropDrawer>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="md:max-w-[500px]" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Chat</DialogTitle>
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

      <Dialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <DialogContent className="md:max-w-[500px]" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete All Chats</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete all{' '}
              <span className="font-semibold">
                {conversations.length} chats
              </span>
              ? This action cannot be undone.
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
              onClick={handleConfirmDeleteAll}
              className="rounded-full"
            >
              Delete All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[500px]" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 pt-4">
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
    </>
  )
}
