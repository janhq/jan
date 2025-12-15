import { MoreHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'

import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
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

import { useProjects } from '@/stores/projects-store'

export function NavProjects() {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { projectId?: string }
  const projects = useProjects((state) => state.projects)
  const getProjects = useProjects((state) => state.getProjects)
  const deleteProject = useProjects((state) => state.deleteProject)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [itemToDelete, setItemToDelete] = useState<Project | null>(null)

  useEffect(() => {
    getProjects()
  }, [getProjects])

  const handleDeleteClick = (item: Project) => {
    setItemToDelete(item)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!itemToDelete) return

    try {
      await deleteProject(itemToDelete.id)
      setDeleteDialogOpen(false)
      setItemToDelete(null)
      // If we're currently viewing the deleted project, redirect to home
      if (params.projectId === itemToDelete.id) {
        navigate({ to: '/' })
      }
    } catch (error) {
      console.error('Failed to delete project:', error)
    }
  }

  if (projects.length === 0) {
    return null
  }

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="text-muted-foreground flex w-full items-center justify-between pr-0">
          Projects
        </SidebarGroupLabel>
        <SidebarMenu>
          {projects.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                asChild
                isActive={params.projectId === item.id}
              >
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: item.id }}
                  title={item.name}
                >
                  <span>{item.name}</span>
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
                  side={isMobile ? 'bottom' : 'right'}
                  align={isMobile ? 'end' : 'start'}
                >
                  <DropDrawerItem
                    variant="destructive"
                    onClick={() => handleDeleteClick(item)}
                  >
                    <div className="flex gap-2 items-center justify-center">
                      <Trash2 className="text-destructive" />
                      <span>Delete Project</span>
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
            <DialogTitle>Delete Project</DialogTitle>
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
