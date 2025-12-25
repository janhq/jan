import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'

import {
  SidebarGroup,
  SidebarMenu,
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
import { AnimatedGroupLabel, AnimatedProjectItem } from '@/components/sidebar/items'

export function NavProjects({ startIndex = 3 }: { startIndex?: number }) {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { projectId?: string }
  const projects = useProjects((state) => state.projects)
  const deleteProject = useProjects((state) => state.deleteProject)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [itemToDelete, setItemToDelete] = useState<Project | null>(null)

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
        <AnimatedGroupLabel index={startIndex}>Projects</AnimatedGroupLabel>
        <SidebarMenu>
          {projects.map((item, idx) => (
            <AnimatedProjectItem
              key={item.id}
              item={item}
              isActive={params.projectId === item.id}
              isMobile={isMobile}
              onDeleteClick={handleDeleteClick}
              index={startIndex + 1 + idx}
            />
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
