import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  ChevronDown,
  Folder,
  GitBranch,
  Home,
  Laptop,
  Pin,
  TreePine,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useThreads } from '@/hooks/useThreads'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useRuntimePermission } from '@/stores/runtime-permission-store'
import {
  getWorkspaceDirectoryKey,
  useWorkspaceDirectories,
  type WorkspaceDirectoryScope,
} from '@/stores/workspace-directory-store'
import {
  useChatWorkspaceContext,
  type ChatWorkLocationMode,
} from '@/stores/chat-workspace-context-store'
import { useCodexProviderProfiles } from '@/stores/codex-provider-profile-store'
import { cn } from '@/lib/utils'
import { isPlatformTauri } from '@/lib/platform/utils'
import {
  getProjectDirectoryPath,
  getProjectDisplayName,
} from '@/lib/project-folders'

const NO_PROJECT_ID = '__no_project__'

type GitWorktreeEntry = {
  path: string
  branch: string
  isMain: boolean
}

type GitWorkspaceTargets = {
  repoRoot: string
  currentBranch?: string
  branches: string[]
  worktrees: GitWorktreeEntry[]
}

type ChatWorkspaceBarProps = {
  /** Key for per-session workspace context (thread id, home, or project-compose:*) */
  contextId: string
  workspaceScope: WorkspaceDirectoryScope
  /** When set, project assignment updates the live thread */
  threadId?: string
  /** Pre-selected project on compose screens (e.g. project page) */
  fixedProject?: { id: string; name: string }
  className?: string
}

function basename(path: string) {
  const trimmed = path.replace(/\/+$/, '')
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

function WorkspaceSegment({
  label,
  value,
  icon: Icon,
  disabled,
  fill,
  compact,
  children,
}: {
  label: string
  value: string
  icon: ComponentType<{ className?: string }>
  disabled?: boolean
  /** When true, grows to fill remaining bar width (for long branch/worktree names). */
  fill?: boolean
  /** When true, sizes tightly to short labels like Local / Worktree. */
  compact?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn(fill ? 'min-w-0 flex-1' : 'shrink-0')}>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label={label}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-2 text-left text-xs transition-colors',
            fill
              ? 'w-full min-w-0'
              : compact
                ? 'w-auto'
                : 'w-auto max-w-[10rem]',
            'hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40',
            disabled && 'pointer-events-none opacity-50'
          )}
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <div
            className={cn(
              'truncate font-medium text-foreground',
              fill ? 'min-w-0 flex-1' : 'min-w-0'
            )}
          >
            {value}
          </div>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-64 min-w-52">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function ChatWorkspaceBar({
  contextId,
  workspaceScope,
  threadId,
  fixedProject,
  className,
}: ChatWorkspaceBarProps) {
  const serviceHub = useServiceHub()
  const { folders, addFolderFromPath } = useThreadManagement()
  const directories = useWorkspaceDirectories((state) => state.directories)
  const thread = useThreads((state) =>
    threadId ? state.threads[threadId] : undefined
  )
  const updateThread = useThreads((state) => state.updateThread)
  const requestRuntimePermission = useRuntimePermission(
    (state) => state.requestPermission
  )

  const workspacePath = useWorkspaceDirectories((state) =>
    state.getDirectory(workspaceScope)
  )
  const setDirectory = useWorkspaceDirectories((state) => state.setDirectory)

  const workMode = useChatWorkspaceContext(
    (state) => state.getContext(contextId).workMode
  )
  const selectedBranch = useChatWorkspaceContext(
    (state) => state.getContext(contextId).selectedBranch
  )
  const selectedWorktreePath = useChatWorkspaceContext(
    (state) => state.getContext(contextId).selectedWorktreePath
  )
  const draftProjectId = useChatWorkspaceContext(
    (state) => state.getContext(contextId).draftProjectId
  )
  const setWorkMode = useChatWorkspaceContext((state) => state.setWorkMode)
  const setSelectedBranch = useChatWorkspaceContext(
    (state) => state.setSelectedBranch
  )
  const setSelectedWorktreePath = useChatWorkspaceContext(
    (state) => state.setSelectedWorktreePath
  )
  const setDraftProject = useChatWorkspaceContext(
    (state) => state.setDraftProject
  )

  const [targets, setTargets] = useState<GitWorkspaceTargets | null>(null)
  const [loadingTargets, setLoadingTargets] = useState(false)

  const cwd = workspacePath || targets?.repoRoot || '.'

  const refreshTargets = useCallback(async () => {
    if (!isPlatformTauri()) return
    setLoadingTargets(true)
    try {
      const next = await invoke<GitWorkspaceTargets>('git_workspace_targets', {
        cwd,
      })
      setTargets(next)
    } catch {
      setTargets(null)
    } finally {
      setLoadingTargets(false)
    }
  }, [cwd])

  useEffect(() => {
    void refreshTargets()
  }, [refreshTargets])

  const folderProjects = useMemo(
    () =>
      folders
        .map((folder) => ({
          folder,
          path: getProjectDirectoryPath(folder, directories),
          displayName: getProjectDisplayName(folder, directories),
        }))
        .filter((entry) => Boolean(entry.path))
        .sort((a, b) => b.folder.updated_at - a.folder.updated_at),
    [folders, directories]
  )

  const currentProjectId =
    thread?.metadata?.project?.id ??
    fixedProject?.id ??
    (draftProjectId === null ? undefined : draftProjectId)

  const currentProject = useMemo(() => {
    if (!currentProjectId) return undefined
    return folders.find((folder) => folder.id === currentProjectId)
  }, [currentProjectId, folders])

  const currentProjectName = useMemo(() => {
    if (currentProject) {
      return getProjectDisplayName(currentProject, directories)
    }
    if (fixedProject?.id) {
      const fixed = folders.find((folder) => folder.id === fixedProject.id)
      if (fixed) return getProjectDisplayName(fixed, directories)
      return fixedProject.name
    }
    return 'No project'
  }, [currentProject, fixedProject, folders, directories])

  const syncWorkspaceToProject = (project: (typeof folders)[number]) => {
    const projectPath = getProjectDirectoryPath(project, directories)
    if (!projectPath) return
    setDirectory(workspaceScope, projectPath)
    void refreshTargets()
  }

  const assignProject = (projectId: string | null) => {
    if (threadId && thread) {
      if (!projectId || projectId === NO_PROJECT_ID) {
        const metadata = { ...thread.metadata }
        delete metadata.project
        updateThread(threadId, { metadata })
        toast.success('Moved to no project')
        return
      }
      const project = folders.find((folder) => folder.id === projectId)
      if (!project) return
      const displayName = getProjectDisplayName(project, directories)
      updateThread(threadId, {
        metadata: {
          ...thread.metadata,
          project: {
            id: project.id,
            name: displayName,
            updated_at: project.updated_at,
          },
        },
      })
      syncWorkspaceToProject(project)
      toast.success(`Project: ${displayName}`)
      return
    }

    if (!projectId || projectId === NO_PROJECT_ID) {
      setDraftProject(contextId, null)
      toast.success('No project')
      return
    }
    const project = folders.find((folder) => folder.id === projectId)
    if (!project) return
    setDraftProject(contextId, project.id)
    syncWorkspaceToProject(project)
    toast.success(`Project: ${getProjectDisplayName(project, directories)}`)
  }

  const chooseProjectFolder = async () => {
    const allowed = await requestRuntimePermission({
      actionId: 'file.choose-project-dir',
      actionLabel: 'choose project folder',
      category: 'file',
      resourceLabel: workspacePath || 'select folder',
      risk: 'medium',
    })
    if (!allowed) return

    const selection = await serviceHub.dialog().open({
      directory: true,
      defaultPath:
        workspacePath ||
        (currentProject
          ? getProjectDirectoryPath(currentProject, directories)
          : undefined) ||
        targets?.repoRoot ||
        undefined,
    })
    if (!selection || Array.isArray(selection)) return

    const project = await addFolderFromPath(selection)
    assignProject(project.id)
  }

  const chooseDirectory = async () => {
    const allowed = await requestRuntimePermission({
      actionId: 'file.choose-workspace-dir',
      actionLabel: 'choose workspace directory',
      category: 'file',
      resourceLabel: workspacePath || 'select folder',
      risk: 'medium',
    })
    if (!allowed) return

    const selection = await serviceHub.dialog().open({
      directory: true,
      defaultPath: workspacePath || targets?.repoRoot || undefined,
    })
    if (!selection || Array.isArray(selection)) return
    setDirectory(workspaceScope, selection)
    void refreshTargets()
  }

  const handleWorkMode = async (mode: ChatWorkLocationMode) => {
    setWorkMode(contextId, mode)
    if (mode === 'local') {
      const root = targets?.repoRoot
      if (root) setDirectory(workspaceScope, root)
      return
    }
    const worktree =
      targets?.worktrees.find((entry) => !entry.isMain) ??
      targets?.worktrees[0]
    if (worktree) {
      setSelectedWorktreePath(contextId, worktree.path)
      setDirectory(workspaceScope, worktree.path)
    }
  }

  const handleSelectBranch = async (branch: string) => {
    if (!targets?.repoRoot) return
    try {
      await invoke('git_checkout_branch', {
        cwd: targets.repoRoot,
        branch,
      })
      setSelectedBranch(contextId, branch)
      setDirectory(workspaceScope, targets.repoRoot)
      await refreshTargets()
      toast.success(`Switched to ${branch}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Checkout failed')
    }
  }

  const handleSelectWorktree = (entry: GitWorktreeEntry) => {
    setSelectedWorktreePath(contextId, entry.path)
    setDirectory(workspaceScope, entry.path)
    toast.success(`Worktree: ${basename(entry.path)}`)
  }

  const handleCreateWorktree = async () => {
    const repoPath = targets?.repoRoot ?? workspacePath
    if (!repoPath) {
      toast.info('Choose a repository directory first')
      return
    }
    const projectName = currentProjectName === 'No project' ? 'chat' : currentProjectName
    try {
      const result = await invoke<{ path: string; branch: string }>(
        'git_worktree_add',
        {
          repoCwd: repoPath,
          name: projectName,
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
      setWorkMode(contextId, 'worktree')
      setSelectedWorktreePath(contextId, result.path)
      setDirectory(workspaceScope, result.path)
      await refreshTargets()
      toast.success(`Worktree created: ${basename(result.path)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Worktree failed')
    }
  }

  const activeBranch =
    selectedBranch ??
    targets?.currentBranch ??
    targets?.branches[0] ??
    'main'

  const activeWorktree = useMemo(() => {
    if (selectedWorktreePath) {
      return (
        targets?.worktrees.find((entry) => entry.path === selectedWorktreePath) ??
        null
      )
    }
    return (
      targets?.worktrees.find((entry) => entry.path === workspacePath) ??
      targets?.worktrees.find((entry) => entry.isMain) ??
      targets?.worktrees[0] ??
      null
    )
  }, [selectedWorktreePath, targets, workspacePath])

  const workLocationLabel =
    workMode === 'worktree' ? 'Worktree' : 'Local'

  const branchTreeLabel =
    workMode === 'worktree'
      ? activeWorktree
        ? `${basename(activeWorktree.path)} (${activeWorktree.branch})`
        : 'Select worktree'
      : activeBranch

  const pathHint = workspacePath
    ? basename(workspacePath)
    : targets?.repoRoot
      ? basename(targets.repoRoot)
      : 'Home'

  return (
    <div
      className={cn(
        'mx-0.5 -mt-px flex items-stretch justify-start overflow-hidden rounded-b-3xl border border-t-0 border-input bg-muted/30 dark:bg-input/20',
        className
      )}
    >
      <WorkspaceSegment
        label="Project"
        value={currentProjectName}
        icon={currentProjectId ? Folder : Home}
      >
        <DropdownMenuItem
          onClick={() => assignProject(NO_PROJECT_ID)}
          className={cn(!currentProjectId && 'bg-accent')}
        >
          <Pin className="size-3.5 text-muted-foreground" />
          <span>No project</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {folderProjects.length === 0 ? (
          <DropdownMenuItem disabled>No project folders yet</DropdownMenuItem>
        ) : (
          folderProjects.map(({ folder, displayName, path }) => (
            <DropdownMenuItem
              key={folder.id}
              onClick={() => assignProject(folder.id)}
              className={cn(currentProjectId === folder.id && 'bg-accent')}
              title={path}
            >
              <Folder className="size-3.5" />
              <span className="truncate">{displayName}</span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void chooseProjectFolder()}>
          <Folder className="size-3.5" />
          <span>Choose project folder…</span>
        </DropdownMenuItem>
      </WorkspaceSegment>

      <div className="w-px shrink-0 bg-border/60" />

      <WorkspaceSegment
        label="Work in"
        value={workLocationLabel}
        icon={workMode === 'worktree' ? TreePine : Laptop}
        compact
      >
        <DropdownMenuItem
          onClick={() => void handleWorkMode('local')}
          className={cn(workMode === 'local' && 'bg-accent')}
        >
          <Laptop className="size-3.5" />
          <span>Local repository</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void handleWorkMode('worktree')}
          className={cn(workMode === 'worktree' && 'bg-accent')}
        >
          <TreePine className="size-3.5" />
          <span>Git worktree</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-[10px] text-muted-foreground">
          {pathHint}
          {loadingTargets ? ' · loading…' : ''}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void chooseDirectory()}>
          <Folder className="size-3.5" />
          <span>Choose folder…</span>
        </DropdownMenuItem>
        {isPlatformTauri() && targets?.repoRoot ? (
          <DropdownMenuItem onClick={() => void handleCreateWorktree()}>
            <TreePine className="size-3.5" />
            <span>New worktree</span>
          </DropdownMenuItem>
        ) : null}
      </WorkspaceSegment>

      <div className="w-px shrink-0 bg-border/60" />

      <WorkspaceSegment
        label={workMode === 'worktree' ? 'Worktree' : 'Branch'}
        value={branchTreeLabel}
        icon={GitBranch}
        disabled={!isPlatformTauri() || !targets}
        fill
      >
        {workMode === 'local' ? (
          <>
            {(targets?.branches ?? []).map((branch) => (
              <DropdownMenuItem
                key={branch}
                onClick={() => void handleSelectBranch(branch)}
                className={cn(activeBranch === branch && 'bg-accent')}
              >
                <GitBranch className="size-3.5" />
                <span className="truncate">{branch}</span>
                {targets?.currentBranch === branch ? (
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    current
                  </span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </>
        ) : (
          <>
            {(targets?.worktrees ?? []).map((entry) => (
              <DropdownMenuItem
                key={entry.path}
                onClick={() => handleSelectWorktree(entry)}
                className={cn(
                  activeWorktree?.path === entry.path && 'bg-accent'
                )}
              >
                <TreePine className="size-3.5" />
                <span className="truncate">
                  {entry.isMain
                    ? `main · ${entry.branch}`
                    : `${basename(entry.path)} · ${entry.branch}`}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void handleCreateWorktree()}>
              <TreePine className="size-3.5" />
              <span>Create worktree…</span>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled
          className="max-w-64 truncate font-mono text-[10px] text-muted-foreground"
          title={workspacePath || getWorkspaceDirectoryKey(workspaceScope)}
        >
          {workspacePath || 'No folder selected'}
        </DropdownMenuItem>
      </WorkspaceSegment>
    </div>
  )
}