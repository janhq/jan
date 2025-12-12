import { ArrowUpRight, MoreHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'

import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerSeparator,
  DropDrawerTrigger,
} from '@/components/ui/dropdrawer'
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
// import { useConversations, type Conversation } from '@/hooks/use-conversations'

import { useConversations } from '@/stores/conversation-store'

export function NavChats() {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { conversationId?: string }
  const conversations = useConversations((state) => state.conversations)
  const getConversations = useConversations((state) => state.getConversations)
  const deleteConversation = useConversations(
    (state) => state.deleteConversation
  )
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false)
  const [itemToDelete, setItemToDelete] = useState<Conversation | null>(null)

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
      await Promise.all(
        conversations.map((conversation) =>
          deleteConversation(conversation.id)
        )
      )
      setDeleteAllDialogOpen(false)
      // Redirect to home after deleting all
      navigate({ to: '/' })
    } catch (error) {
      console.error('Failed to delete all conversations:', error)
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
                >
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
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
                  <DropDrawerItem>
                    <div className="flex gap-2 items-center justify-center">
                      <ArrowUpRight className="text-muted-foreground" />
                      <span>Open in New Tab</span>
                    </div>
                  </DropDrawerItem>
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
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]" showCloseButton={false}>
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
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <DialogContent className="sm:max-w-[425px]" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete All Chats</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete all{' '}
              <span className="font-semibold">{conversations.length} chats</span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleConfirmDeleteAll}>
              Delete All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
