import { ArrowUpRight, MoreHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'

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

type NavChatItem = {
  name: string
  url: string
}

const navChats: NavChatItem[] = [
  {
    name: 'Project Management & Task Tracking',
    url: '#',
  },
  {
    name: 'Family Recipe Collection & Meal Planning',
    url: '#',
  },
  {
    name: 'Fitness Tracker & Workout Routines',
    url: '#',
  },
  {
    name: 'Book Notes & Reading List',
    url: '#',
  },
]

export function NavChats() {
  const { isMobile } = useSidebar()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [itemToDelete, setItemToDelete] = useState<NavChatItem | null>(null)

  const handleDeleteClick = (item: NavChatItem) => {
    setItemToDelete(item)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = () => {
    // TODO: Implement actual delete logic here
    console.log('Deleting:', itemToDelete)
    setDeleteDialogOpen(false)
    setItemToDelete(null)
  }

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="text-muted-foreground">
          Chats
        </SidebarGroupLabel>
        <SidebarMenu>
          {navChats.map((item) => (
            <SidebarMenuItem key={item.name}>
              <SidebarMenuButton asChild>
                <a href={item.url} title={item.name}>
                  <span>{item.name}</span>
                </a>
              </SidebarMenuButton>
              <DropDrawer>
                <DropDrawerTrigger asChild>
                  <SidebarMenuAction showOnHover>
                    <MoreHorizontal />
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
                &quot;{itemToDelete?.name}&quot;?
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
    </>
  )
}
