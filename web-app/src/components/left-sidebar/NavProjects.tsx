import {
  ChevronRight,
  FolderEditIcon,
  FolderIcon,
  FolderOpenIcon,
  GripVertical,
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
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'z-10')}>
      <Collapsible open={isOpen} onOpenChange={onOpenChange} className="group/collapsible">
      <SidebarMenuItem>
        <div className="group/project-row relative flex w-full items-center">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder project"
            className="text-muted-foreground/50 flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center opacity-0 transition-opacity group-hover/project-row:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </button>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="hover:bg-sidebar-foreground/8 flex size-6 shrink-0 items-center justify-center rounded-md transition-colors"
              aria-label={isOpen ? 'Collapse project' : 'Expand project'}
            >
              <ChevronRight
                className={cn(
                  'text-muted-foreground size-4 shrink-0 transition-transform',
                  isOpen && 'rotate-90'
                )}
              />
            </button>
          </CollapsibleTrigger>
          <SidebarMenuButton asChild className="min-w-0 flex-1 pr-8">
            <Link to="/project/$projectId" params={{ projectId: item.id }}>
              <FolderIcon className="text-foreground/70" size={16} />
              <span className="truncate">{item.name}</span>
            </Link>
          </SidebarMenuButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuAction className="hover:bg-sidebar-foreground/8 transition-opacity group-hover/project-row:opacity-100 group-focus-within/project-row:opacity-100 data-[state=open]:opacity-100 md:opacity-0">
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
        </div>
        <CollapsibleContent>
          {threads.length > 0 && (
            <SidebarMenuSub>
              <ThreadList threads={threads} subItem />
            </SidebarMenuSub>
          )}
        </CollapsibleContent>
      </SidebarMenuItem>
      </Collapsible>
    </div>
  )
}

export function NavProjects() {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()
  const { folders, updateFolder, reorderFolders } = useThreadManagement()
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Distance-based activation: drag starts as soon as the pointer moves
      // a few px from the grip. (Delay-based activation required holding still
      // first, so a natural grab-and-move was misread as a click.)
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor)
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      reorderFolders(String(active.id), String(over.id))
    }
  }

  if (folders.length === 0) {
    return null
  }

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>{t('common:projects.title')}</SidebarGroupLabel>
        <SidebarMenu>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={folders.map((f) => f.id)}
              strategy={verticalListSortingStrategy}
            >
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
                    onOpenChange={(expanded) =>
                      setProjectExpanded(item.id, expanded)
                    }
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                )
              })}
            </SortableContext>
          </DndContext>
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
