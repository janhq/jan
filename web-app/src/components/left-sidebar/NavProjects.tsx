import {
  FolderEditIcon,
  FolderIcon,
  FolderOpenIcon,
  MoreHorizontal,
  Trash2,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useThreadManagement } from "@/hooks/useThreadManagement"
import { Link, useNavigate } from "@tanstack/react-router"


import { useState } from "react"
import type { ThreadFolder } from "@/services/projects/types"
import AddProjectDialog from "@/containers/dialogs/AddProjectDialog"
import { DeleteProjectDialog } from "@/containers/dialogs/DeleteProjectDialog"

function ProjectItem({
  item,
  isMobile,
  onEdit,
  onDelete,
}: {
  item: ThreadFolder
  isMobile: boolean
  onEdit: (project: ThreadFolder) => void
  onDelete: (project: ThreadFolder) => void
}) {

  const navigate = useNavigate()

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link
          to="/project/$projectId"
          params={{ projectId: item.id }}
        >
          <FolderIcon  className="text-foreground/70" size={16} />
          <span>{item.name}</span>
        </Link>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover className="hover:bg-sidebar-foreground/8">
            <MoreHorizontal />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-48"
          side={isMobile ? "bottom" : "right"}
          align={isMobile ? "end" : "start"}
        >
          <DropdownMenuItem onSelect={() => {
            navigate({ to: '/project/$projectId', params: { projectId: item.id } })
          }}>
            <FolderOpenIcon className="text-muted-foreground" />
            <span>View Project</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEdit(item)}>
            <FolderEditIcon className="text-muted-foreground" />
            <span>Edit Project</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(item)}>
            <Trash2 />
            <span>Delete Project</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

export function NavProjects() {
  const { isMobile } = useSidebar()
  const { folders, updateFolder } = useThreadManagement()

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<ThreadFolder | null>(null)

  const handleEdit = (project: ThreadFolder) => {
    setSelectedProject(project)
    setEditDialogOpen(true)
  }

  const handleDelete = (project: ThreadFolder) => {
    setSelectedProject(project)
    setDeleteDialogOpen(true)
  }

  const handleSaveEdit = async (name: string, assistantId?: string) => {
    if (selectedProject) {
      await updateFolder(selectedProject.id, name, assistantId)
      setEditDialogOpen(false)
      setSelectedProject(null)
    }
  }

  if (folders.length === 0) {
    return null
  }

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        <SidebarMenu>
          {folders.map((item) => (
            <ProjectItem
              key={item.id}
              item={item}
              isMobile={isMobile}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </SidebarMenu>
      </SidebarGroup>

      <AddProjectDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        editingKey={selectedProject?.id ?? null}
        initialData={selectedProject ?? undefined}
        onSave={handleSaveEdit}
      />

      <DeleteProjectDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        projectId={selectedProject?.id}
        projectName={selectedProject?.name}
      />
    </>
  )
}
