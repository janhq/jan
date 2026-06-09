import {
  ChevronDown,
  ChevronRight,
  Archive,
  FolderEditIcon,
  FolderIcon,
  FolderOpen,
  GitBranch,
  MessageCircle,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
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
  SidebarGroupAction,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  useSidebar,
} from "@/components/ui/sidebar"
import { DeleteAllThreadsInProjectDialog } from "@/containers/dialogs/DeleteAllThreadsInProjectDialog"
import { DeleteThreadDialog } from "@/containers/dialogs"
import { useThreads } from "@/hooks/useThreads"
import { useThreadManagement } from "@/hooks/useThreadManagement"
import { useServiceHub } from "@/hooks/useServiceHub"
import { Link, useNavigate } from "@tanstack/react-router"
import { MouseEvent, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "@/i18n/react-i18next-compat"
import type { ThreadFolder } from "@/services/projects/types"
import AddProjectDialog from "@/containers/dialogs/AddProjectDialog"
import { DeleteProjectDialog } from "@/containers/dialogs/DeleteProjectDialog"
import { useWorkspaceDirectories } from "@/stores/workspace-directory-store"
import { getProjectDisplayName } from "@/lib/project-folders"
import { useCodexProviderProfiles } from "@/stores/codex-provider-profile-store"
import { invoke } from "@tauri-apps/api/core"

const PINNED_PROJECTS_STORAGE_KEY = "jan.navProjects.pinnedProjects"
const EXPANDED_PROJECTS_STORAGE_KEY = "jan.navProjects.expandedProjects"
const EXPANDED_PROJECTS_SECTION_KEY = "jan.navProjects.projectsSectionExpanded"

type ProjectThread = ReturnType<typeof useThreads.getState>['threads'][string]

type ProjectItemState = {
  item: ThreadFolder
  displayName: string
  threads: ProjectThread[]
  activeThreadId?: string
  isMobile: boolean
  isPinned: boolean
  isExpanded: boolean
  directory?: string
  onEdit: (project: ThreadFolder) => void
  onDelete: (project: ThreadFolder) => void
  onAddChat: (projectId: string) => void
  onArchiveChats: (project: ThreadFolder) => void
  onToggleExpand: (projectId: string) => void
  onPinToggle: (project: ThreadFolder) => void
  onRevealInFinder: (project: ThreadFolder, directory?: string) => void
  onCreateWorktree: (project: ThreadFolder) => void
}

type ProjectThreadItemState = {
  thread: ProjectThread
  isActive: boolean
}

function ProjectThreadItem({ thread, isActive }: ProjectThreadItemState) {
  const { t } = useTranslation()
  const deleteThread = useThreads((state) => state.deleteThread)
  const [archiveOpen, setArchiveOpen] = useState(false)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild size="sm" isActive={isActive}>
        <Link to="/threads/$threadId" params={{ threadId: thread.id }}>
          <MessageCircle className="text-muted-foreground" />
          <span className="truncate">
            {thread.title || t("common:newThread")}
          </span>
        </Link>
      </SidebarMenuButton>

      <SidebarMenuAction
        showOnHover
        className="hover:bg-sidebar-foreground/8"
        onClick={() => setArchiveOpen(true)}
      >
        <Archive className="text-muted-foreground" />
        <span className="sr-only">{t("common:archiveChats")}</span>
      </SidebarMenuAction>

      <DeleteThreadDialog
        thread={thread}
        onDelete={deleteThread}
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        withoutTrigger
      />
    </SidebarMenuItem>
  )
}

function ProjectItem({
  item,
  displayName,
  threads,
  activeThreadId,
  isMobile,
  isPinned,
  isExpanded,
  directory,
  onEdit,
  onDelete,
  onAddChat,
  onArchiveChats,
  onToggleExpand,
  onPinToggle,
  onRevealInFinder,
  onCreateWorktree,
}: ProjectItemState) {
  const { t } = useTranslation()
  const threadList = useMemo(() => {
    return [...threads].sort((a, b) => (b.updated || 0) - (a.updated || 0))
  }, [threads])

  const isActiveProject = threadList.some((thread) => thread.id === activeThreadId)

  const handleToggleExpand = (
    event: MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault()
    event.stopPropagation()
    onToggleExpand(item.id)
  }

  const handleNewChat = () => {
    onAddChat(item.id)
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActiveProject}>
        <button
          type="button"
          aria-label={
            isExpanded
              ? t("common:projects.collapseProject")
              : t("common:projects.expandProject")
          }
          aria-expanded={isExpanded}
          className="group/menu-project w-full pr-14"
          onClick={handleToggleExpand}
        >
          <FolderIcon className="text-foreground/70" size={16} />
          <GitBranch size={14} className="text-muted-foreground" />
          <span>{displayName}</span>
          {isPinned && <Pin size={12} className="text-amber-400" />}
        </button>
      </SidebarMenuButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover className="hover:bg-sidebar-foreground/8">
            <MoreHorizontal />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-56"
          side={isMobile ? "bottom" : "right"}
          align={isMobile ? "end" : "start"}
        >
          <DropdownMenuItem onSelect={() => onPinToggle(item)}>
            {isPinned ? <PinOff size={16} /> : <Pin size={16} />}
            <span>{isPinned ? t("projects.unpinProject") : t("projects.pinProject")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => onRevealInFinder(item, directory)}
          >
            <FolderOpen size={16} className="text-muted-foreground" />
            <span>{t("projects.revealInFinder")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onCreateWorktree(item)}>
            <GitBranch size={16} className="text-muted-foreground" />
            <span>{t("projects.createPermanentWorktree")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAddChat(item.id)}>
            <Plus className="text-muted-foreground" />
            <span>{t("common:newChat")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEdit(item)}>
            <FolderEditIcon className="text-muted-foreground" />
            <span>{t("projects.editProject")}</span>
          </DropdownMenuItem>
          <DeleteAllThreadsInProjectDialog
            projectName={item.name}
            threadCount={threadList.length}
            onDeleteAll={() => onArchiveChats(item)}
            menuItemLabel={t("projects.archiveChats")}
            title={t("projects.archiveChatsDialog.title", {
              projectName: item.name,
              count: threadList.length,
            })}
            description={t("projects.archiveChatsDialog.description", {
              projectName: item.name,
              count: threadList.length,
            })}
            confirmLabel={t("projects.archiveChats")}
            destructive
          />
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(item)}>
            <Trash2 />
            <span>{t("projects.removeProject")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SidebarMenuAction
        showOnHover
        className="right-7 hover:bg-sidebar-foreground/8"
        onClick={handleNewChat}
      >
        <Plus className="text-muted-foreground" />
        <span className="sr-only">{t("common:newChat")}</span>
      </SidebarMenuAction>

      {isExpanded && threadList.length > 0 ? (
        <SidebarMenuSub>
          {threadList.map((thread) => (
            <ProjectThreadItem
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
            />
          ))}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  )
}

export function NavProjects() {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()
  const { folders, addFolderFromPath, updateFolderFromPath } =
    useThreadManagement()
  const directories = useWorkspaceDirectories((state) => state.directories)
  const threads = useThreads((state) => state.threads)
  const activeThreadId = useThreads((state) => state.currentThreadId)
  const deleteAllThreadsByProject = useThreads(
    (state) => state.deleteAllThreadsByProject
  )
  const getProjectDirectory = useWorkspaceDirectories((state) => state.getDirectory)
  const navigate = useNavigate()
  const serviceHub = useServiceHub()

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<ThreadFolder | null>(null)
  const [isProjectsSectionExpanded, setIsProjectsSectionExpanded] = useState(() => {
    if (typeof window === "undefined") return true

    try {
      const persisted = localStorage.getItem(EXPANDED_PROJECTS_SECTION_KEY)
      if (!persisted) return true

      const parsed = JSON.parse(persisted)
      if (typeof parsed !== "boolean") return true

      return parsed
    } catch {
      return true
    }
  })
  const [pinnedProjectIds, setPinnedProjectIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return []

    try {
      const persisted = localStorage.getItem(PINNED_PROJECTS_STORAGE_KEY)
      if (!persisted) return []

      const parsed = JSON.parse(persisted)
      if (!Array.isArray(parsed)) return []

      return parsed.filter((value): value is string => typeof value === "string")
    } catch {
      return []
    }
  })
  const [expandedProjectIds, setExpandedProjectIds] = useState<
    Record<string, boolean>
  >(() => {
    if (typeof window === "undefined") return {}

    try {
      const persisted = localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY)
      if (!persisted) return {}

      const parsed = JSON.parse(persisted)
      if (!parsed || typeof parsed !== "object") return {}

      return Object.entries(parsed).reduce(
        (acc, [key, value]) =>
          typeof key === "string" && typeof value === "boolean"
            ? { ...acc, [key]: value }
            : acc,
        {} as Record<string, boolean>,
      )
    } catch {
      return {}
    }
  })

  useEffect(() => {
    if (folders.length === 0) return

    setExpandedProjectIds((previous) => {
      const next = { ...previous }
      let hasChanges = false
      const folderIds = new Set(folders.map((folder) => folder.id))

      for (const folder of folders) {
        if (next[folder.id] === undefined) {
          next[folder.id] = true
          hasChanges = true
        }
      }

      for (const projectId of Object.keys(next)) {
        if (!folderIds.has(projectId)) {
          delete next[projectId]
          hasChanges = true
        }
      }

      if (!hasChanges) return previous

      localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [folders])

  useEffect(() => {
    if (folders.length === 0) {
      if (pinnedProjectIds.length > 0) {
        localStorage.setItem(PINNED_PROJECTS_STORAGE_KEY, JSON.stringify([]))
        setPinnedProjectIds([])
      }
      return
    }

    setPinnedProjectIds((previous) => {
      const folderIds = new Set(folders.map((folder) => folder.id))
      const next = previous.filter((projectId) => folderIds.has(projectId))

      if (next.length === previous.length) return previous

      localStorage.setItem(PINNED_PROJECTS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [folders, pinnedProjectIds])

  const orderedFolders = useMemo(() => {
    const pinnedSet = new Set(pinnedProjectIds)
    const pinned = folders.filter((folder) => pinnedSet.has(folder.id))
    const unpinned = folders.filter((folder) => !pinnedSet.has(folder.id))
    return [...pinned, ...unpinned]
  }, [folders, pinnedProjectIds])

  const isPinned = (projectId: string) => pinnedProjectIds.includes(projectId)
  const isExpanded = (projectId: string) =>
    expandedProjectIds[projectId] !== false

  const handleEdit = (project: ThreadFolder) => {
    setSelectedProject(project)
    setEditDialogOpen(true)
  }

  const handleDelete = (project: ThreadFolder) => {
    setSelectedProject(project)
    setDeleteDialogOpen(true)
  }

  const handleAddChat = (projectId: string) => {
    navigate({ to: "/project/$projectId", params: { projectId } })
  }

  const handleArchiveChats = (project: ThreadFolder) => {
    deleteAllThreadsByProject(project.id)
  }

  const handleTogglePin = (project: ThreadFolder) => {
    setPinnedProjectIds((previous) => {
      const next = isPinned(project.id)
        ? previous.filter((id) => id !== project.id)
        : [...previous, project.id]

      localStorage.setItem(PINNED_PROJECTS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const handleToggleExpand = (projectId: string) => {
    setExpandedProjectIds((previous) => {
      const next = {
        ...previous,
        [projectId]: !(previous[projectId] ?? true),
      }

      localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const handleRevealInFinder = (project: ThreadFolder, directory?: string) => {
    const targetPath =
      directory ??
      getProjectDirectory({
        type: "project",
        id: project.id,
        label: project.name,
      })

    if (!targetPath) {
      toast.info(t("projects.noProjectDirectorySet"))
      return
    }

    void serviceHub
      .opener()
      .revealItemInDir(targetPath)
      .catch(() => {
        toast.error(t("projects.revealInFinderError"))
      })
  }

  const handleCreateWorktree = async (project: ThreadFolder) => {
    const repoPath = getProjectDirectory({
      type: "project",
      id: project.id,
      label: project.name,
    })

    if (!repoPath) {
      toast.info(t("projects.noProjectDirectorySet"))
      return
    }

    try {
      const result = await invoke<{ path: string; branch: string }>(
        "git_worktree_add",
        {
          repoCwd: repoPath,
          name: project.name,
          branchName: null,
          worktreePath: null,
        }
      )

      const { activeProfileId, profiles, upsertProfile } =
        useCodexProviderProfiles.getState()
      if (activeProfileId && profiles[activeProfileId]) {
        const profile = profiles[activeProfileId]
        const addDirs = Array.from(
          new Set([...(profile.addDirs ?? []), result.path])
        )
        upsertProfile({ ...profile, addDirs })
      }

      toast.success(
        `Worktree ready at ${result.path} (branch ${result.branch}). Added to active Codex profile add-dirs.`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleToggleProjectsSection = () => {
    setIsProjectsSectionExpanded((previous) => {
      const next = !previous
      localStorage.setItem(EXPANDED_PROJECTS_SECTION_KEY, JSON.stringify(next))
      return next
    })
  }

  const handleCreateProject = async (
    directoryPath: string,
    assistantId?: string
  ) => {
    const newProject = await addFolderFromPath(directoryPath, assistantId)
    setCreateDialogOpen(false)
    navigate({
      to: "/project/$projectId",
      params: { projectId: newProject.id },
    })
  }

  const handleSaveEdit = async (
    directoryPath: string,
    assistantId?: string
  ) => {
    if (selectedProject) {
      await updateFolderFromPath(
        selectedProject.id,
        directoryPath,
        assistantId
      )
      setEditDialogOpen(false)
      setSelectedProject(null)
    }
  }

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>{t("common:projects.title")}</SidebarGroupLabel>
        <SidebarGroupAction
          className="hover:bg-sidebar-foreground/8"
          onClick={handleToggleProjectsSection}
        >
          {isProjectsSectionExpanded ? (
            <ChevronDown size={16} />
          ) : (
            <ChevronRight size={16} />
          )}
          <span className="sr-only">Toggle Projects</span>
        </SidebarGroupAction>
        <SidebarGroupAction
          className="right-8 hover:bg-sidebar-foreground/8"
          onClick={() => setCreateDialogOpen(true)}
        >
          <Plus className="text-muted-foreground" />
          <span className="sr-only">{t("projects.createNewProject")}</span>
        </SidebarGroupAction>

        {isProjectsSectionExpanded ? (
          <SidebarMenu>
            {orderedFolders.map((item) => (
              <ProjectItem
                key={item.id}
                item={item}
                displayName={getProjectDisplayName(item, directories)}
                threads={Object.values(threads).filter(
                  (thread) => thread.metadata?.project?.id === item.id
                )}
                activeThreadId={activeThreadId}
                isMobile={isMobile}
                isPinned={isPinned(item.id)}
                isExpanded={isExpanded(item.id)}
                directory={getProjectDirectory({
                  type: "project",
                  id: item.id,
                  label: item.name,
                })}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onAddChat={handleAddChat}
                onArchiveChats={handleArchiveChats}
                onToggleExpand={handleToggleExpand}
                onPinToggle={handleTogglePin}
                onRevealInFinder={handleRevealInFinder}
                onCreateWorktree={handleCreateWorktree}
              />
            ))}
          </SidebarMenu>
        ) : null}
      </SidebarGroup>

      <AddProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        editingKey={null}
        onSave={handleCreateProject}
      />

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
