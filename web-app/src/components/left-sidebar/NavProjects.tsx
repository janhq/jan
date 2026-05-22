import {
  ChevronRight,
  FolderEditIcon,
  FolderIcon,
  FolderOpenIcon,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  useSidebar,
} from '@/components/ui/sidebar'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useThreads } from '@/hooks/useThreads'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { ThreadFolder } from '@/services/projects/types'
import AddProjectDialog from '@/containers/dialogs/AddProjectDialog'
import { DeleteProjectDialog } from '@/containers/dialogs/DeleteProjectDialog'
import ThreadList from '@/containers/ThreadList'
import { cn } from '@/lib/utils'

function ProjectItem({
  item,
  isMobile,
  threads,
  isOpen,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  item: ThreadFolder
  isMobile: boolean
  threads: Thread[]
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (project: ThreadFolder) => void
  onDelete: (project: ThreadFolder) => void
}) {
  const navigate = useNavigate()

  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange} className="group/collapsible">
      <SidebarMenuItem>
        <div className="flex w-full items-center">
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              type="button"
              className="w-8 shrink-0 p-0"
              aria-label={isOpen ? 'Collapse project' : 'Expand project'}
            >
              <ChevronRight
                className={cn(
                  'text-muted-foreground size-4 shrink-0 transition-transform',
                  isOpen && 'rotate-90'
                )}
              />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <SidebarMenuButton asChild className="min-w-0 flex-1 pr-8">
            <Link to="/project/$projectId" params={{ projectId: item.id }}>
              <FolderIcon className="text-foreground/70" size={16} />
              <span className="truncate">{item.name}</span>
            </Link>
          </SidebarMenuButton>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction showOnHover className="hover:bg-sidebar-foreground/8">
              <MoreHorizontal />
              <span className="sr-only">More</span>
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-48"
            side={isMobile ? 'bottom' : 'right'}
            align={isMobile ? 'end' : 'start'}
          >
            <DropdownMenuItem
              onSelect={() => {
                navigate({ to: '/project/$projectId', params: { projectId: item.id } })
              }}
            >
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
        <CollapsibleContent>
          {threads.length > 0 && (
            <SidebarMenuSub>
              <ThreadList threads={threads} subItem />
            </SidebarMenuSub>
          )}
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

export function NavProjects() {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()
  const { folders, updateFolder } = useThreadManagement()
  const threads = useThreads((state) => state.threads)
  const currentThreadId = useThreads((state) => state.currentThreadId)
  const projectExpanded = useLeftPanel((state) => state.projectExpanded)
  const setProjectExpanded = useLeftPanel((state) => state.setProjectExpanded)

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<ThreadFolder | null>(null)

  const threadsByProject = useMemo(() => {
    const out: Record<string, Thread[]> = {}
    for (const thread of Object.values(threads)) {
      const projectId = thread.metadata?.project?.id
      if (projectId) {
        if (!out[projectId]) {
          out[projectId] = []
        }
        out[projectId].push(thread)
      }
    }
    return out
  }, [threads])

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

  const isProjectOpen = (projectId: string, projectThreads: Thread[]) => {
    if (projectId in projectExpanded) {
      return projectExpanded[projectId]
    }
    if (currentThreadId) {
      return projectThreads.some((thread) => thread.id === currentThreadId)
    }
    return false
  }

  if (folders.length === 0) {
    return null
  }

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>{t('common:projects.title')}</SidebarGroupLabel>
        <SidebarMenu>
          {folders.map((item) => {
            const projectThreads = threadsByProject[item.id] ?? []
            const open = isProjectOpen(item.id, projectThreads)
            return (
              <ProjectItem
                key={item.id}
                item={item}
                isMobile={isMobile}
                threads={projectThreads}
                isOpen={open}
                onOpenChange={(expanded) => setProjectExpanded(item.id, expanded)}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            )
          })}
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
