import { IconLayoutSidebar } from '@tabler/icons-react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal as XTerm } from '@xterm/xterm'
import {
  ChevronRight,
  ClipboardCheck,
  Copy,
  File,
  Folder,
  FolderOpen,
  Globe,
  Loader2,
  MoreHorizontal,
  Paperclip,
  PanelBottom,
  RefreshCw,
  RefreshCcw,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import '@xterm/xterm/css/xterm.css'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  CHAT_SIDE_PANEL_MAX_WIDTH,
  CHAT_SIDE_PANEL_MIN_WIDTH,
  CHAT_SIDE_PANEL_DROPDOWN_SECTIONS,
  getChatSidePanelSection,
  type ChatSidePanelSection,
  type ChatSidePanelSectionItem,
} from '@/constants/chat-side-panel'
import { useSidebarResize } from '@/hooks/use-sidebar-resize'
import {
  NEW_THREAD_ATTACHMENT_KEY,
  useChatAttachments,
} from '@/hooks/useChatAttachments'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useThreads } from '@/hooks/useThreads'
import { mergeButtonRefs } from '@/lib/merge-button-refs'
import { cn } from '@/lib/utils'
import {
  createBrowserSelectionAttachment,
  createContextBriefAttachment,
  createDocumentAttachment,
  createProcessListAttachment,
  createRuntimeLogAttachment,
  createTerminalOutputAttachment,
  type Attachment,
} from '@/types/attachment'
import { useBrowserRuntime } from '@/stores/browser-runtime-store'
import {
  useTerminalRuntime,
  type TerminalSessionInfo,
} from '@/stores/terminal-runtime-store'
import { useChatSidePanel } from '@/stores/chat-side-panel-store'
import {
  useStudioSettings,
  type StudioSamplerSettings,
} from '@/stores/studio-settings-store'
import { useCodexProviderProfiles } from '@/stores/codex-provider-profile-store'
import {
  useWorkspacePanel,
  type WorkspaceBottomPanelSection,
} from '@/stores/workspace-panel-store'
import {
  useWorkspaceDirectories,
  type WorkspaceDirectoryScope,
} from '@/stores/workspace-directory-store'
import { useRuntimePermission } from '@/stores/runtime-permission-store'
import { toast } from 'sonner'

const ANSI_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(27)}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
  'g'
)

function SamplerSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-foreground">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{value}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => {
          if (next !== undefined) onChange(Number(next.toFixed(3)))
        }}
      />
    </div>
  )
}

type DirectoryTreeEntry = {
  path: string
  name: string
  isDirectory: boolean
  size?: number
}

type ModelToolsPanelScope = WorkspaceDirectoryScope & {
  threadId?: string
}

const DEFAULT_PANEL_SCOPE: ModelToolsPanelScope = {
  id: 'default',
  type: 'workspace',
  label: 'Workspace',
}

const BROWSER_PANEL_TARGET_ID = 'workspace-browser-panel'

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.next',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'dist',
  'node_modules',
  'target',
])

function getFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

async function readDirectoryEntries(
  directoryPath: string
): Promise<DirectoryTreeEntry[]> {
  const { fs } = await import('@janhq/core')
  const pathsResult = await fs.readdirSync(directoryPath)
  const paths: string[] = Array.isArray(pathsResult) ? pathsResult : []
  const entries = await Promise.all(
    paths.map(async (path) => {
      const name = getFileName(path)
      try {
        const stat = await fs.fileStat(path)
        return {
          path,
          name,
          isDirectory: !!stat?.isDirectory,
          size: stat?.size,
        }
      } catch {
        return {
          path,
          name,
          isDirectory: false,
        }
      }
    })
  )

  return entries
    .filter(
      (entry) => !entry.isDirectory || !IGNORED_DIRECTORY_NAMES.has(entry.name)
    )
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

function DirectoryTreeNode({
  entry,
  depth = 0,
}: {
  entry: DirectoryTreeEntry
  depth?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [children, setChildren] = useState<DirectoryTreeEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadChildren = useCallback(async () => {
    if (!entry.isDirectory || children) return

    setLoading(true)
    setError(null)
    try {
      setChildren(await readDirectoryEntries(entry.path))
    } catch (err) {
      setChildren([])
      setError(err instanceof Error ? err.message : 'Unable to read directory')
    } finally {
      setLoading(false)
    }
  }, [children, entry.isDirectory, entry.path])

  const toggleExpanded = async () => {
    if (!entry.isDirectory) return
    const nextExpanded = !expanded
    setExpanded(nextExpanded)
    if (nextExpanded) await loadChildren()
  }

  const Icon = entry.isDirectory ? (expanded ? FolderOpen : Folder) : File

  return (
    <div>
      <button
        type="button"
        className={cn(
          'flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs',
          'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
        )}
        style={{ paddingLeft: `${depth * 0.75 + 0.375}rem` }}
        title={entry.path}
        onClick={toggleExpanded}
      >
        {entry.isDirectory ? (
          <ChevronRight
            className={cn(
              'size-3 shrink-0 transition-transform',
              expanded && 'rotate-90'
            )}
          />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{entry.name}</span>
      </button>

      {expanded && (
        <div>
          {loading ? (
            <div
              className="flex h-7 items-center gap-2 px-1.5 text-xs text-muted-foreground"
              style={{ paddingLeft: `${(depth + 1) * 0.75 + 0.375}rem` }}
            >
              <Loader2 className="size-3 animate-spin" />
              <span>Loading</span>
            </div>
          ) : error ? (
            <div
              className="truncate px-1.5 py-1 text-xs text-destructive"
              style={{ paddingLeft: `${(depth + 1) * 0.75 + 0.375}rem` }}
              title={error}
            >
              {error}
            </div>
          ) : children?.length ? (
            children.map((child) => (
              <DirectoryTreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
              />
            ))
          ) : (
            <div
              className="px-1.5 py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: `${(depth + 1) * 0.75 + 0.375}rem` }}
            >
              Empty
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DirectoryScopeControls({
  scope,
  path,
  displayPath = path,
  onPickDirectory,
  onClearDirectory,
  onRefresh,
  canPickDirectory = true,
}: {
  scope: ModelToolsPanelScope
  path?: string
  displayPath?: string
  onPickDirectory: () => void
  onClearDirectory: () => void
  onRefresh?: () => void
  canPickDirectory?: boolean
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">
            {scope.type === 'project'
              ? 'Project directory'
              : scope.type === 'chat'
                ? 'Chat directory'
                : 'Workspace directory'}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {scope.label}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {path && onRefresh && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="rounded-md"
              aria-label="Refresh directory"
              title="Refresh"
              onClick={onRefresh}
            >
              <RefreshCcw className="size-3.5" />
            </Button>
          )}
          {path && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="rounded-md"
              aria-label="Clear directory"
              title="Clear"
              onClick={onClearDirectory}
            >
              <X className="size-3.5" />
            </Button>
          )}
          <Button
            variant="outline"
            size="xs"
            className="rounded-md"
            disabled={!canPickDirectory}
            onClick={onPickDirectory}
            title={canPickDirectory ? undefined : 'Desktop app only'}
          >
            <Folder className="size-3.5" />
            {path ? 'Change' : 'Choose'}
          </Button>
        </div>
      </div>
      {displayPath && (
        <div className="truncate rounded-md bg-foreground/5 px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
          {displayPath}
        </div>
      )}
    </div>
  )
}

function FilesSection({ scope }: { scope: ModelToolsPanelScope }) {
  const serviceHub = useServiceHub()
  const requestRuntimePermission = useRuntimePermission(
    (state) => state.requestPermission
  )
  const path = useWorkspaceDirectories((state) => state.getDirectory(scope))
  const canBrowseDirectories = IS_TAURI
  const effectivePath =
    path ??
    (canBrowseDirectories && scope.type === 'workspace' ? './' : undefined)
  const setDirectory = useWorkspaceDirectories((state) => state.setDirectory)
  const clearDirectory = useWorkspaceDirectories(
    (state) => state.clearDirectory
  )

  const [entries, setEntries] = useState<DirectoryTreeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const pickDirectory = useCallback(async () => {
    if (!canBrowseDirectories) return
    const allowed = await requestRuntimePermission({
      actionId: 'file.choose-directory',
      actionLabel: 'choose workspace directory',
      category: 'file',
      resourceLabel: scope.label,
      risk: 'medium',
      details: {
        scope: scope.type,
        currentPath: path,
      },
    })
    if (!allowed) return

    const selection = await serviceHub.dialog().open({
      directory: true,
      defaultPath: path,
    })
    if (!selection || Array.isArray(selection)) return
    setDirectory(scope, selection)
  }, [
    canBrowseDirectories,
    path,
    requestRuntimePermission,
    scope,
    serviceHub,
    setDirectory,
  ])

  useEffect(() => {
    if (!effectivePath) {
      setEntries([])
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    readDirectoryEntries(effectivePath)
      .then((nextEntries) => {
        if (!cancelled) setEntries(nextEntries)
      })
      .catch((err) => {
        if (!cancelled) {
          setEntries([])
          setError(
            err instanceof Error ? err.message : 'Unable to read directory'
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [effectivePath, refreshKey])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <DirectoryScopeControls
        scope={scope}
        path={path}
        displayPath={effectivePath}
        onPickDirectory={pickDirectory}
        onClearDirectory={() => clearDirectory(scope)}
        onRefresh={() => setRefreshKey((key) => key + 1)}
        canPickDirectory={canBrowseDirectories}
      />

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/60 bg-card p-1">
        {!canBrowseDirectories ? (
          <div className="flex min-h-[220px] items-center justify-center px-4 text-center text-sm text-muted-foreground">
            File browsing is available in the desktop app.
          </div>
        ) : !effectivePath ? (
          <button
            type="button"
            className="flex min-h-[220px] w-full flex-col items-center justify-center gap-2 rounded-md px-4 text-center text-sm text-muted-foreground hover:bg-foreground/5"
            onClick={pickDirectory}
          >
            <Folder className="size-8 text-muted-foreground/50" />
            <span>Choose a directory to browse files.</span>
          </button>
        ) : loading ? (
          <div className="flex min-h-[220px] items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="p-3 text-sm text-destructive">{error}</div>
        ) : entries.length ? (
          entries.map((entry) => (
            <DirectoryTreeNode key={entry.path} entry={entry} />
          ))
        ) : (
          <div className="p-3 text-sm text-muted-foreground">
            Empty directory.
          </div>
        )}
      </div>
    </div>
  )
}

function ChatWorkspaceSection({ scope }: { scope: ModelToolsPanelScope }) {
  const serviceHub = useServiceHub()
  const requestRuntimePermission = useRuntimePermission(
    (state) => state.requestPermission
  )
  const path = useWorkspaceDirectories((state) => state.getDirectory(scope))
  const canBrowseDirectories = IS_TAURI
  const effectivePath =
    path ??
    (canBrowseDirectories && scope.type === 'workspace' ? './' : undefined)
  const setDirectory = useWorkspaceDirectories((state) => state.setDirectory)
  const clearDirectory = useWorkspaceDirectories(
    (state) => state.clearDirectory
  )

  const pickDirectory = useCallback(async () => {
    if (!canBrowseDirectories) return
    const allowed = await requestRuntimePermission({
      actionId: 'file.choose-directory',
      actionLabel: 'choose workspace directory',
      category: 'file',
      resourceLabel: scope.label,
      risk: 'medium',
      details: {
        scope: scope.type,
        currentPath: path,
      },
    })
    if (!allowed) return

    const selection = await serviceHub.dialog().open({
      directory: true,
      defaultPath: path,
    })
    if (!selection || Array.isArray(selection)) return
    setDirectory(scope, selection)
  }, [
    canBrowseDirectories,
    path,
    requestRuntimePermission,
    scope,
    serviceHub,
    setDirectory,
  ])

  return (
    <div className="space-y-3">
      <DirectoryScopeControls
        scope={scope}
        path={path}
        displayPath={effectivePath}
        onPickDirectory={pickDirectory}
        onClearDirectory={() => clearDirectory(scope)}
        canPickDirectory={canBrowseDirectories}
      />
      <MoveChatToProjectSection scope={scope} />
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <div className="flex items-center gap-2">
          <Folder className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">
            Directory scope
          </h3>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Files uses this directory for the current{' '}
          {scope.type === 'project'
            ? 'project'
            : scope.type === 'chat'
              ? 'chat'
              : 'workspace'}
          .
        </p>
      </section>
    </div>
  )
}

function MoveChatToProjectSection({ scope }: { scope: ModelToolsPanelScope }) {
  const threadId = scope.threadId
  const { folders } = useThreadManagement()
  const updateThread = useThreads((state) => state.updateThread)
  const thread = useThreads((state) =>
    threadId ? state.threads[threadId] : undefined
  )

  if (!threadId || !thread) return null

  const currentProjectId = thread.metadata?.project?.id
  const availableProjects = folders
    .filter((folder) => folder.id !== currentProjectId)
    .sort((a, b) => b.updated_at - a.updated_at)

  const assignThreadToProject = (projectId: string) => {
    const project = folders.find((folder) => folder.id === projectId)
    if (!project) return

    updateThread(threadId, {
      metadata: {
        ...thread.metadata,
        project: {
          id: project.id,
          name: project.name,
          updated_at: project.updated_at,
        },
      },
    })

    toast.success(`Thread moved to "${project.name}"`)
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">Project</h3>
          <p className="truncate text-xs text-muted-foreground">
            {thread.metadata?.project?.name ?? 'Vanilla chat'}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="xs"
              className="shrink-0 rounded-md"
              disabled={availableProjects.length === 0}
            >
              <Folder className="size-3.5" />
              Move
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-60 min-w-44">
            {availableProjects.length === 0 ? (
              <DropdownMenuItem disabled>
                No projects available
              </DropdownMenuItem>
            ) : (
              availableProjects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => assignThreadToProject(project.id)}
                >
                  <Folder className="size-4" />
                  <span className="truncate">{project.name}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </section>
  )
}

function PlaceholderSection({
  section,
}: {
  section: ChatSidePanelSectionItem
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <div className="flex items-center gap-2">
        <section.icon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">{section.label}</h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        This panel slot is reserved for the local agent workspace. It can attach
        repo files, run side conversations, surface review findings, or open a
        runtime terminal without leaving chat.
      </p>
    </section>
  )
}

function BrowserSection() {
  const [url, setUrl] = useState('https://')
  const currentThreadId = useThreads((state) => state.currentThreadId)
  const requestRuntimePermission = useRuntimePermission(
    (state) => state.requestPermission
  )
  const registerTarget = useBrowserRuntime((state) => state.registerTarget)
  const updateTarget = useBrowserRuntime((state) => state.updateTarget)
  const target = useBrowserRuntime(
    (state) => state.targets[BROWSER_PANEL_TARGET_ID]
  )
  const setAttachmentsForThread = useChatAttachments(
    (state) => state.setAttachments
  )
  const attachmentsKey = currentThreadId ?? NEW_THREAD_ATTACHMENT_KEY
  const normalizedUrl = url.trim()
  const hasNavigableUrl = normalizedUrl.length > 'https://'.length

  useEffect(() => {
    registerTarget({
      id: BROWSER_PANEL_TARGET_ID,
      label: 'Workspace browser',
      backend: 'in-app-preview',
      url: hasNavigableUrl ? normalizedUrl : '',
      updatedAt: Date.now(),
      capabilities: {
        canNavigate: true,
        canInspectDom: false,
        canScreenshot: false,
        canAct: false,
      },
    })
  }, [hasNavigableUrl, normalizedUrl, registerTarget])

  useEffect(() => {
    updateTarget(BROWSER_PANEL_TARGET_ID, {
      url: hasNavigableUrl ? normalizedUrl : '',
      title: hasNavigableUrl ? normalizedUrl : undefined,
    })
  }, [hasNavigableUrl, normalizedUrl, updateTarget])

  const attachCurrentPage = async () => {
    if (!target?.url) return

    const allowed = await requestRuntimePermission({
      actionId: 'browser.attach-context',
      actionLabel: 'attach browser context to chat',
      category: 'browser',
      resourceLabel: target.title ?? target.url,
      risk: 'medium',
      details: {
        targetId: target.id,
        url: target.url,
        title: target.title,
        selectionKind: target.selection?.kind ?? 'page',
      },
    })
    if (!allowed) return

    setAttachmentsForThread(attachmentsKey, (attachments) => [
      ...attachments,
      createBrowserSelectionAttachment({
        targetId: target.id,
        targetLabel: target.label,
        url: target.url,
        title: target.title,
        capturedAt: Date.now(),
        selection: target.selection ?? { kind: 'page' },
      }),
    ])

    toast.success('Browser context attached')
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Globe className="size-4 shrink-0 text-muted-foreground" />
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Enter URL"
          className="h-8 text-sm"
        />
        <Button
          variant="outline"
          size="icon-sm"
          disabled={!target?.url}
          aria-label="Attach browser context"
          title="Attach browser context"
          onClick={() => void attachCurrentPage()}
        >
          <Paperclip className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border/60 bg-card">
        {url.length > 'https://'.length ? (
          <iframe
            title="Browser view"
            src={url}
            className="h-full min-h-[320px] w-full bg-background"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 px-6 text-center">
            <Globe className="size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Enter a URL above or enable Jan Browser MCP from chat to browse
              with your signed-in sessions.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function ContextPickerSection({
  onOpenSection,
}: {
  onOpenSection: (section: ChatSidePanelSection) => void
}) {
  const currentThreadId = useThreads((state) => state.currentThreadId)
  const serviceHub = useServiceHub()
  const requestRuntimePermission = useRuntimePermission(
    (state) => state.requestPermission
  )
  const rememberedPermissions = useRuntimePermission((state) => state.remembered)
  const permissionAudit = useRuntimePermission((state) => state.audit)
  const clearRememberedPermissions = useRuntimePermission(
    (state) => state.clearRemembered
  )
  const clearPermissionAudit = useRuntimePermission((state) => state.clearAudit)
  const revokeRememberedPermission = useRuntimePermission(
    (state) => state.revokeRemembered
  )
  const attachmentsKey = currentThreadId ?? NEW_THREAD_ATTACHMENT_KEY
  const attachments = useChatAttachments(
    useCallback(
      (state) => state.getAttachments(attachmentsKey),
      [attachmentsKey]
    )
  )
  const setAttachmentsForThread = useChatAttachments(
    (state) => state.setAttachments
  )
  const clearAttachmentsForThread = useChatAttachments(
    (state) => state.clearAttachments
  )
  const browserTarget = useBrowserRuntime(
    (state) => state.targets[BROWSER_PANEL_TARGET_ID]
  )
  const activeSessionId = useTerminalRuntime((state) => state.activeSessionId)
  const activeSession = useTerminalRuntime((state) =>
    state.activeSessionId ? state.sessions[state.activeSessionId] : undefined
  )
  const sessionNames = useTerminalRuntime((state) => state.sessionNames)

  const normalizeContextContent = (content: string, maxChars = 12000) => {
    const trimmed = content.replace(ANSI_ESCAPE_PATTERN, '').trim()
    return trimmed.length > maxChars
      ? trimmed.slice(trimmed.length - maxChars)
      : trimmed
  }

  const getContextAttachmentLabel = (attachment: Attachment) => {
    if (attachment.type === 'document') return attachment.name
    if (attachment.type === 'browser-selection') {
      return attachment.browserSelection?.title || attachment.browserSelection?.url || attachment.name
    }
    if (attachment.type === 'terminal-output') {
      return attachment.terminalOutput
        ? `${attachment.terminalOutput.shell} · ${attachment.terminalOutput.captureMode}`
        : attachment.name
    }
    if (attachment.type === 'runtime-log') {
      return attachment.runtimeLog?.sourceLabel || attachment.name
    }
    if (attachment.type === 'process-list') {
      const count = attachment.processList?.processes.length ?? 0
      return `${attachment.processList?.sourceLabel || 'Processes'} · ${count}`
    }
    return attachment.name
  }

  const getContextAttachmentKind = (attachment: Attachment) => {
    if (attachment.type === 'document') return 'file'
    if (attachment.type === 'browser-selection') return 'browser'
    if (attachment.type === 'terminal-output') return 'terminal'
    if (attachment.type === 'runtime-log') return 'log'
    if (attachment.type === 'process-list') return 'processes'
    if (attachment.type === 'context-brief') return 'brief'
    return attachment.type
  }

  const buildContextBriefItem = useCallback((attachment: Attachment) => {
    const label = getContextAttachmentLabel(attachment)
    if (attachment.type === 'document') {
      return {
        type: attachment.type,
        name: attachment.name,
        label,
        details: {
          path: attachment.path,
          fileType: attachment.fileType,
          size: attachment.size,
        },
      }
    }
    if (attachment.type === 'browser-selection') {
      return {
        type: attachment.type,
        name: attachment.name,
        label,
        details: {
          url: attachment.browserSelection?.url,
          title: attachment.browserSelection?.title,
          selectionKind: attachment.browserSelection?.selection?.kind,
        },
      }
    }
    if (attachment.type === 'terminal-output') {
      return {
        type: attachment.type,
        name: attachment.name,
        label,
        details: {
          shell: attachment.terminalOutput?.shell,
          cwd: attachment.terminalOutput?.cwd,
          captureMode: attachment.terminalOutput?.captureMode,
          characters: attachment.terminalOutput?.content.length,
        },
      }
    }
    if (attachment.type === 'runtime-log') {
      return {
        type: attachment.type,
        name: attachment.name,
        label,
        details: {
          source: attachment.runtimeLog?.source,
          sourceLabel: attachment.runtimeLog?.sourceLabel,
          runtimeId: attachment.runtimeLog?.runtimeId,
          characters: attachment.runtimeLog?.content.length,
        },
      }
    }
    if (attachment.type === 'process-list') {
      return {
        type: attachment.type,
        name: attachment.name,
        label,
        details: {
          source: attachment.processList?.source,
          sourceLabel: attachment.processList?.sourceLabel,
          count: attachment.processList?.processes.length,
        },
      }
    }
    return {
      type: attachment.type,
      name: attachment.name,
      label,
    }
  }, [])

  const removeContextAttachment = (indexToRemove: number) => {
    setAttachmentsForThread(attachmentsKey, (current) =>
      current.filter((_, index) => index !== indexToRemove)
    )
  }

  const attachContextBrief = useCallback(async () => {
    const sourceItems = attachments.filter(
      (attachment) => attachment.type !== 'context-brief'
    )
    if (sourceItems.length === 0) {
      toast.info('Attach context before creating a brief')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'context.attach-brief',
      actionLabel: 'attach context inventory brief',
      category: 'app',
      resourceLabel: `${sourceItems.length} context item${sourceItems.length === 1 ? '' : 's'}`,
      risk: 'low',
    })
    if (!allowed) return

    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current.filter((attachment) => attachment.type !== 'context-brief'),
      createContextBriefAttachment({
        capturedAt: Date.now(),
        items: sourceItems.map(buildContextBriefItem),
      }),
    ])
    toast.success('Context brief attached')
  }, [
    attachments,
    attachmentsKey,
    buildContextBriefItem,
    requestRuntimePermission,
    setAttachmentsForThread,
  ])

  const attachFilesFromContext = useCallback(async () => {
    const allowed = await requestRuntimePermission({
      actionId: 'file.attach-context',
      actionLabel: 'attach local files to chat',
      category: 'file',
      resourceLabel: 'file picker',
      risk: 'medium',
    })
    if (!allowed) return

    const selection = await serviceHub.dialog().open({
      multiple: true,
      filters: [
        {
          name: 'Context files',
          extensions: ['*'],
        },
      ],
    })
    if (!selection) return

    const paths = Array.isArray(selection) ? selection : [selection]
    if (paths.length === 0) return

    const { fs } = await import('@janhq/core')
    const prepared = await Promise.all(
      paths.map(async (path) => {
        const name = path.split(/[\\/]/).filter(Boolean).pop() || path
        const fileType = name.includes('.')
          ? name.split('.').pop()?.toLowerCase()
          : undefined
        let size: number | undefined
        try {
          const stat = await fs.fileStat(path)
          size = stat?.size ? Number(stat.size) : undefined
        } catch (error) {
          console.warn('Failed to read file size for context attachment', error)
        }
        return createDocumentAttachment({
          name,
          path,
          fileType,
          size,
          parseMode: 'auto',
        })
      })
    )

    let added = 0
    setAttachmentsForThread(attachmentsKey, (current) => {
      const existingPaths = new Set(
        current
          .filter((attachment) => attachment.type === 'document')
          .map((attachment) => attachment.path)
          .filter(Boolean)
      )
      const nextFiles = prepared.filter((attachment) => {
        if (!attachment.path || existingPaths.has(attachment.path)) return false
        existingPaths.add(attachment.path)
        return true
      })
      added = nextFiles.length
      return nextFiles.length > 0 ? [...current, ...nextFiles] : current
    })

    if (added > 0) {
      toast.success(`${added} file${added === 1 ? '' : 's'} attached`)
    } else {
      toast.info('Selected files are already attached')
    }
  }, [
    attachmentsKey,
    requestRuntimePermission,
    serviceHub,
    setAttachmentsForThread,
  ])

  const attachBrowserContext = useCallback(async () => {
    if (!browserTarget?.url) {
      onOpenSection('browser')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'browser.attach-context',
      actionLabel: 'attach browser context to chat',
      category: 'browser',
      resourceLabel: browserTarget.title ?? browserTarget.url,
      risk: 'medium',
      details: {
        targetId: browserTarget.id,
        url: browserTarget.url,
        title: browserTarget.title,
        selectionKind: browserTarget.selection?.kind ?? 'page',
      },
    })
    if (!allowed) return

    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current,
      createBrowserSelectionAttachment({
        targetId: browserTarget.id,
        targetLabel: browserTarget.label,
        url: browserTarget.url,
        title: browserTarget.title,
        capturedAt: Date.now(),
        selection: browserTarget.selection ?? { kind: 'page' },
      }),
    ])
    toast.success('Browser context attached')
  }, [
    attachmentsKey,
    browserTarget,
    onOpenSection,
    requestRuntimePermission,
    setAttachmentsForThread,
  ])

  const attachTerminalScrollback = useCallback(async () => {
    if (!activeSession || !activeSessionId) {
      onOpenSection('terminal')
      return
    }

    const content = await invoke<string>('read_terminal_scrollback', {
      sessionId: activeSessionId,
    })
    const trimmedContent = content.replace(ANSI_ESCAPE_PATTERN, '').trim()
    if (!trimmedContent) {
      toast.info('No terminal scrollback to attach')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'terminal.attach-output',
      actionLabel: 'attach terminal output to chat',
      category: 'shell',
      resourceLabel:
        sessionNames[activeSession.sessionId] ?? activeSession.shell,
      risk: 'medium',
      details: {
        sessionId: activeSession.sessionId,
        shell: activeSession.shell,
        captureMode: 'scrollback',
        characters: trimmedContent.length,
      },
    })
    if (!allowed) return

    const maxChars = 12000
    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current,
      createTerminalOutputAttachment({
        sessionId: activeSession.sessionId,
        shell: activeSession.shell,
        cwd: activeSession.cwd,
        status: activeSession.status,
        exitCode: activeSession.exitCode,
        capturedAt: Date.now(),
        captureMode: 'scrollback',
        content:
          trimmedContent.length > maxChars
            ? trimmedContent.slice(trimmedContent.length - maxChars)
            : trimmedContent,
      }),
    ])
    toast.success('Terminal scrollback attached')
  }, [
    activeSession,
    activeSessionId,
    attachmentsKey,
    onOpenSection,
    requestRuntimePermission,
    sessionNames,
    setAttachmentsForThread,
  ])

  const attachAppLogs = useCallback(async () => {
    const allowed = await requestRuntimePermission({
      actionId: 'logs.attach-app',
      actionLabel: 'attach app logs to chat',
      category: 'app',
      resourceLabel: 'app.log',
      risk: 'medium',
    })
    if (!allowed) return

    let content = ''
    try {
      content = await invoke<string>('read_logs')
    } catch (error) {
      toast.error('Failed to read app logs', {
        description: error instanceof Error ? error.message : String(error),
      })
      return
    }

    const normalized = normalizeContextContent(content)
    if (!normalized) {
      toast.info('No app logs to attach')
      return
    }

    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current,
      createRuntimeLogAttachment({
        source: 'app',
        sourceLabel: 'App',
        capturedAt: Date.now(),
        content: normalized,
      }),
    ])
    toast.success('App logs attached')
  }, [attachmentsKey, requestRuntimePermission, setAttachmentsForThread])

  const attachStudioRuntimeLogs = useCallback(async () => {
    const processes = await serviceHub.studio().listRuntimeProcesses()
    if (processes.length === 0) {
      toast.info('No managed runtime logs to attach')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'logs.attach-studio-runtime',
      actionLabel: 'attach managed runtime logs to chat',
      category: 'app',
      resourceLabel: `${processes.length} managed runtime${processes.length === 1 ? '' : 's'}`,
      risk: 'medium',
      details: {
        runtimes: processes.map((process) => ({
          runtimeId: process.runtimeId,
          pid: process.pid,
          model: process.model,
          baseUrl: process.baseUrl,
        })),
      },
    })
    if (!allowed) return

    const logBlocks: string[] = []
    for (const process of processes) {
      const raw = await serviceHub.studio().readRuntimeLogs(process.runtimeId)
      const normalized = normalizeContextContent(raw, 6000)
      if (!normalized) continue
      logBlocks.push(
        [
          `# ${process.runtimeId}`,
          `pid: ${process.pid}`,
          `model: ${process.model ?? 'unknown'}`,
          `base_url: ${process.baseUrl}`,
          normalized,
        ].join('\n')
      )
    }

    const content = normalizeContextContent(logBlocks.join('\n\n'), 16000)
    if (!content) {
      toast.info('No managed runtime logs to attach')
      return
    }

    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current,
      createRuntimeLogAttachment({
        source: 'studio-runtime',
        sourceLabel: 'Managed runtime',
        runtimeId: 'all-managed-runtimes',
        capturedAt: Date.now(),
        content,
      }),
    ])
    toast.success('Managed runtime logs attached')
  }, [
    attachmentsKey,
    requestRuntimePermission,
    serviceHub,
    setAttachmentsForThread,
  ])

  const attachRuntimeProcesses = useCallback(async () => {
    const studioProcesses = await serviceHub.studio().listRuntimeProcesses()
    const codexProcesses = await invoke<
      Array<{ sessionId: string; pid: number }>
    >('list_codex_app_server_processes')

    const processes = [
      ...studioProcesses.map((process) => ({
        kind: 'studio-runtime',
        runtimeId: process.runtimeId,
        pid: process.pid,
        model: process.model,
        baseUrl: process.baseUrl,
        logPath: process.logPath,
      })),
      ...codexProcesses.map((process) => ({
        kind: 'codex-app-server',
        sessionId: process.sessionId,
        pid: process.pid,
      })),
    ]

    if (processes.length === 0) {
      toast.info('No managed runtime processes to attach')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'process.attach-managed',
      actionLabel: 'attach managed runtime process list to chat',
      category: 'app',
      resourceLabel: `${processes.length} managed process${processes.length === 1 ? '' : 'es'}`,
      risk: 'low',
      details: { count: processes.length },
    })
    if (!allowed) return

    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current,
      createProcessListAttachment({
        source: 'studio-runtime',
        sourceLabel: 'Managed runtimes',
        capturedAt: Date.now(),
        processes,
      }),
    ])
    toast.success('Managed runtime processes attached')
  }, [
    attachmentsKey,
    requestRuntimePermission,
    serviceHub,
    setAttachmentsForThread,
  ])

  const attachSystemProcesses = useCallback(async () => {
    const allowed = await requestRuntimePermission({
      actionId: 'process.attach-system',
      actionLabel: 'attach running process snapshot to chat',
      category: 'app',
      resourceLabel: 'system process list',
      risk: 'medium',
      details: {
        limit: 80,
      },
    })
    if (!allowed) return

    const processes = await invoke<
      Array<{ pid: number; name: string; command?: string | null }>
    >('list_running_processes', { limit: 80 })

    if (processes.length === 0) {
      toast.info('No running processes to attach')
      return
    }

    setAttachmentsForThread(attachmentsKey, (current) => [
      ...current,
      createProcessListAttachment({
        source: 'system-process',
        sourceLabel: 'System processes',
        capturedAt: Date.now(),
        processes,
      }),
    ])
    toast.success('Running process snapshot attached')
  }, [
    attachmentsKey,
    requestRuntimePermission,
    setAttachmentsForThread,
  ])

  const contextCounts = {
    files: attachments.filter((attachment) => attachment.type === 'document')
      .length,
    browser: attachments.filter(
      (attachment) => attachment.type === 'browser-selection'
    ).length,
    terminal: attachments.filter(
      (attachment) => attachment.type === 'terminal-output'
    ).length,
    logs: attachments.filter((attachment) => attachment.type === 'runtime-log')
      .length,
    processes: attachments.filter(
      (attachment) => attachment.type === 'process-list'
    ).length,
    briefs: attachments.filter((attachment) => attachment.type === 'context-brief')
      .length,
  }
  const rememberedPermissionKeys = Object.keys(rememberedPermissions)

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border/60 bg-card p-3">
        <div className="flex items-center gap-2">
          <Paperclip className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">
            Workspace context
          </h3>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Attach the local evidence the agent should see. Attached items appear
          as chips in the composer and are injected into the next message.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span>Files: {contextCounts.files}</span>
          <span>Browser: {contextCounts.browser}</span>
          <span>Terminal: {contextCounts.terminal}</span>
          <span>Logs: {contextCounts.logs}</span>
          <span>Processes: {contextCounts.processes}</span>
          <span>Briefs: {contextCounts.briefs}</span>
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">
              Runtime permissions
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {rememberedPermissionKeys.length === 0
                ? 'No local runtime actions are remembered.'
                : `${rememberedPermissionKeys.length} local action${rememberedPermissionKeys.length === 1 ? '' : 's'} remembered.`}
            </p>
          </div>
          <Button
            variant="outline"
            size="xs"
            className="shrink-0 rounded-md"
            disabled={rememberedPermissionKeys.length === 0}
            onClick={clearRememberedPermissions}
          >
            Reset
          </Button>
        </div>
        {rememberedPermissionKeys.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {rememberedPermissionKeys.map((key) => (
              <button
                type="button"
                key={key}
                className="group flex max-w-full items-center gap-1 truncate rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title={`Revoke ${key}`}
                onClick={() => revokeRememberedPermission(key)}
              >
                <span className="truncate">{key}</span>
                <X className="size-2.5 opacity-0 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">
              Permission audit
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {permissionAudit.length === 0
                ? 'No local runtime permission decisions recorded.'
                : `${permissionAudit.length} recent decision${permissionAudit.length === 1 ? '' : 's'} recorded.`}
            </p>
          </div>
          <Button
            variant="outline"
            size="xs"
            className="shrink-0 rounded-md"
            disabled={permissionAudit.length === 0}
            onClick={clearPermissionAudit}
          >
            Clear
          </Button>
        </div>
        {permissionAudit.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {permissionAudit.slice(0, 6).map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md bg-foreground/5 px-2 py-1.5 text-xs"
              >
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 font-mono text-[10px]',
                    entry.decision === 'deny'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  )}
                >
                  {entry.decision}
                </span>
                <span
                  className="min-w-0 truncate text-muted-foreground"
                  title={`${entry.actionLabel}${entry.resourceLabel ? ` · ${entry.resourceLabel}` : ''}`}
                >
                  {entry.actionLabel}
                  {entry.resourceLabel ? ` · ${entry.resourceLabel}` : ''}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(entry.decidedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">
              Attached context
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {attachments.length === 0
                ? 'No context is attached to the next message.'
                : `${attachments.length} item${attachments.length === 1 ? '' : 's'} attached to the next message.`}
            </p>
          </div>
          <Button
            variant="outline"
            size="xs"
            className="shrink-0 rounded-md"
            disabled={attachments.length === 0}
            onClick={() => clearAttachmentsForThread(attachmentsKey)}
          >
            Clear
          </Button>
        </div>
        {attachments.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {attachments.map((attachment, index) => (
              <div
                key={`${attachment.type}-${index}-${attachment.name}`}
                className="flex items-center gap-2 rounded-md bg-foreground/5 px-2 py-1.5 text-xs"
              >
                <span className="shrink-0 rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {getContextAttachmentKind(attachment)}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-muted-foreground"
                  title={getContextAttachmentLabel(attachment)}
                >
                  {getContextAttachmentLabel(attachment)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Remove context"
                  onClick={() => removeContextAttachment(index)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-2">
        <ContextSourceCard
          icon={Folder}
          title="Files"
          description="Attach local workspace files directly to the next message."
          actionLabel="Attach files"
          onAction={() => void attachFilesFromContext()}
        />
        <ContextSourceCard
          icon={Globe}
          title="Browser"
          description={
            browserTarget?.url
              ? browserTarget.url
              : 'Open a page first, then attach its page context.'
          }
          actionLabel={browserTarget?.url ? 'Attach page' : 'Open browser'}
          onAction={() => void attachBrowserContext()}
        />
        <ContextSourceCard
          icon={Terminal}
          title="Terminal"
          description={
            activeSession
              ? sessionNames[activeSession.sessionId] ?? activeSession.shell
              : 'Start or select a terminal session first.'
          }
          actionLabel={activeSession ? 'Attach scrollback' : 'Open terminal'}
          onAction={() => void attachTerminalScrollback()}
        />
        <ContextSourceCard
          icon={ClipboardCheck}
          title="App logs"
          description="Attach the desktop app log tail for crashes, plugin errors, and local runtime diagnostics."
          actionLabel="Attach logs"
          onAction={() => void attachAppLogs()}
        />
        <ContextSourceCard
          icon={ClipboardCheck}
          title="Runtime logs"
          description="Attach logs from managed local model runtimes such as Ollama or vLLM."
          actionLabel="Attach runtime logs"
          onAction={() => void attachStudioRuntimeLogs()}
        />
        <ContextSourceCard
          icon={ClipboardCheck}
          title="Running runtimes"
          description="Attach the managed runtime and Codex app-server process snapshot."
          actionLabel="Attach processes"
          onAction={() => void attachRuntimeProcesses()}
        />
        <ContextSourceCard
          icon={ClipboardCheck}
          title="Running apps"
          description="Attach a bounded local process snapshot for debugging what is running on the desktop."
          actionLabel="Attach process list"
          onAction={() => void attachSystemProcesses()}
        />
        <ContextSourceCard
          icon={Paperclip}
          title="Context brief"
          description="Attach a structured inventory of the current files, browser, terminal, logs, and process context."
          actionLabel="Attach brief"
          onAction={() => void attachContextBrief()}
        />
      </div>
    </div>
  )
}

function ContextSourceCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  disabled,
}: {
  icon: typeof Folder
  title: string
  description: string
  actionLabel: string
  onAction?: () => void
  disabled?: boolean
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-foreground">{title}</h4>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        <Button
          variant="outline"
          size="xs"
          className="shrink-0 rounded-md"
          disabled={disabled}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      </div>
    </section>
  )
}

function ModelSettingsSection({
  settings,
  setSettings,
}: {
  settings: StudioSamplerSettings
  setSettings: (settings: StudioSamplerSettings) => void
}) {
  const serviceHub = useServiceHub()
  const requestRuntimePermission = useRuntimePermission(
    (state) => state.requestPermission
  )
  const profiles = useCodexProviderProfiles((state) => state.profiles)
  const activeProfileId = useCodexProviderProfiles(
    (state) => state.activeProfileId
  )
  const upsertProfile = useCodexProviderProfiles(
    (state) => state.upsertProfile
  )
  const removeProfile = useCodexProviderProfiles((state) => state.removeProfile)
  const setActiveProfile = useCodexProviderProfiles(
    (state) => state.setActiveProfile
  )
  const profileList = Object.values(profiles).sort(
    (a, b) => b.updatedAt - a.updatedAt
  )
  const activeProfile = activeProfileId ? profiles[activeProfileId] : undefined
  const [profileName, setProfileName] = useState('Local OpenAI-compatible')
  const [profileBaseUrl, setProfileBaseUrl] = useState(
    'http://localhost:11434/v1'
  )
  const [profileModel, setProfileModel] = useState('')
  const [profileApiKeyEnv, setProfileApiKeyEnv] = useState('OPENAI_API_KEY')
  const [profileCodexHome, setProfileCodexHome] = useState(
    '.codex/profiles/local'
  )
  const [editingProfileId, setEditingProfileId] = useState<string | undefined>(
    undefined
  )
  const [profileProbe, setProfileProbe] = useState<{
    loading: boolean
    reachable?: boolean
    statusCode?: number
    modelCount?: number
    error?: string
  }>({ loading: false })
  const [profileArtifactResult, setProfileArtifactResult] = useState<{
    codexHome: string
    manifestPath: string
    envPath: string
  } | null>(null)

  const applyProfilePreset = (
    preset: 'ollama' | 'llama-cpp' | 'openai-compatible'
  ) => {
    setEditingProfileId(undefined)
    setProfileProbe({ loading: false })
    setProfileArtifactResult(null)
    if (preset === 'ollama') {
      setProfileName('Ollama local')
      setProfileBaseUrl('http://localhost:11434/v1')
      setProfileModel('qwen3-coder')
      setProfileApiKeyEnv('OLLAMA_API_KEY')
      setProfileCodexHome('.codex/profiles/ollama')
      return
    }
    if (preset === 'llama-cpp') {
      setProfileName('llama.cpp local')
      setProfileBaseUrl('http://localhost:8080/v1')
      setProfileModel('local-model')
      setProfileApiKeyEnv('LLAMA_CPP_API_KEY')
      setProfileCodexHome('.codex/profiles/llama-cpp')
      return
    }
    setProfileName('OpenAI-compatible')
    setProfileBaseUrl('https://api.openai.com/v1')
    setProfileModel('gpt-4.1')
    setProfileApiKeyEnv('OPENAI_API_KEY')
    setProfileCodexHome('.codex/profiles/openai-compatible')
  }

  const startNewProfile = () => {
    setEditingProfileId(undefined)
    setProfileProbe({ loading: false })
    setProfileArtifactResult(null)
    setProfileName('Local OpenAI-compatible')
    setProfileBaseUrl('http://localhost:11434/v1')
    setProfileModel('')
    setProfileApiKeyEnv('OPENAI_API_KEY')
    setProfileCodexHome('.codex/profiles/local')
  }

  const saveProfile = () => {
    const trimmedName = profileName.trim()
    const trimmedBaseUrl = profileBaseUrl.trim()
    const trimmedModel = profileModel.trim()
    const trimmedCodexHome = profileCodexHome.trim()
    if (!trimmedName || !trimmedBaseUrl || !trimmedModel || !trimmedCodexHome) {
      toast.info('Profile name, base URL, model, and CODEX_HOME are required')
      return
    }

    const saved = upsertProfile({
      id: editingProfileId,
      name: trimmedName,
      baseUrl: trimmedBaseUrl,
      model: trimmedModel,
      apiKeyEnv: profileApiKeyEnv.trim() || undefined,
      codexHome: trimmedCodexHome,
      providerType: trimmedBaseUrl.includes('11434')
        ? 'ollama'
        : trimmedBaseUrl.includes('localhost')
          ? 'llama-cpp'
          : 'openai-compatible',
    })
    setActiveProfile(saved.id)
    setEditingProfileId(saved.id)
    toast.success('Runtime profile saved')
  }

  const loadProfileIntoForm = (profileId: string) => {
    const profile = profiles[profileId]
    if (!profile) return
    setProfileName(profile.name)
    setProfileBaseUrl(profile.baseUrl)
    setProfileModel(profile.model)
    setProfileApiKeyEnv(profile.apiKeyEnv ?? '')
    setProfileCodexHome(profile.codexHome)
    setActiveProfile(profileId)
    setEditingProfileId(profileId)
    setProfileProbe({ loading: false })
    setProfileArtifactResult(null)
  }

  const probeProfileEndpoint = async () => {
    const baseUrl = profileBaseUrl.trim()
    if (!baseUrl) {
      toast.info('Base URL is required before probing')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'provider.probe-endpoint',
      actionLabel: 'probe provider endpoint',
      category: 'app',
      resourceLabel: baseUrl,
      risk: baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')
        ? 'low'
        : 'medium',
      details: {
        baseUrl,
        path: '/models',
      },
    })
    if (!allowed) return

    setProfileProbe({ loading: true })
    try {
      const result = await serviceHub.studio().probeOpenaiEndpoint(baseUrl)
      setProfileProbe({
        loading: false,
        reachable: result.reachable,
        statusCode: result.statusCode,
        modelCount: result.modelCount,
        error: result.error,
      })
      if (result.reachable) {
        toast.success('Provider endpoint reachable')
      } else {
        toast.error('Provider endpoint not reachable', {
          description: result.error,
        })
      }
    } catch (error) {
      setProfileProbe({
        loading: false,
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
      })
      toast.error('Provider probe failed', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const chooseCodexHomeDirectory = async () => {
    const allowed = await requestRuntimePermission({
      actionId: 'file.choose-codex-home',
      actionLabel: 'choose isolated CODEX_HOME directory',
      category: 'file',
      resourceLabel: profileCodexHome,
      risk: 'medium',
    })
    if (!allowed) return

    const selection = await serviceHub.dialog().open({
      directory: true,
      defaultPath: profileCodexHome,
    })
    if (!selection || Array.isArray(selection)) return
    setProfileCodexHome(selection)
    setProfileArtifactResult(null)
  }

  const writeProfileArtifacts = async () => {
    if (!activeProfile) {
      toast.info('Save or select a profile before writing artifacts')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'file.write-codex-provider-profile',
      actionLabel: 'write isolated provider profile artifacts',
      category: 'file',
      resourceLabel: activeProfile.codexHome,
      risk: 'medium',
      details: {
        codexHome: activeProfile.codexHome,
        baseUrl: activeProfile.baseUrl,
        model: activeProfile.model,
      },
    })
    if (!allowed) return

    const result = await invoke<{
      codexHome: string
      manifestPath: string
      envPath: string
    }>('write_codex_provider_profile_artifacts', {
      request: {
        name: activeProfile.name,
        baseUrl: activeProfile.baseUrl,
        model: activeProfile.model,
        apiKeyEnv: activeProfile.apiKeyEnv,
        codexHome: activeProfile.codexHome,
        providerType: activeProfile.providerType,
      },
    })

    setProfileArtifactResult(result)
    toast.success('Provider profile artifacts written')
  }

  const profilePreview = activeProfile
    ? {
        env: {
          CODEX_HOME: activeProfile.codexHome,
          OPENAI_BASE_URL: activeProfile.baseUrl,
          OPENAI_API_KEY: activeProfile.apiKeyEnv
            ? `$${activeProfile.apiKeyEnv}`
            : '<unset>',
        },
        profile: {
          provider_type: activeProfile.providerType,
          model: activeProfile.model,
          base_url: activeProfile.baseUrl,
        },
      }
    : null

  const copyProfilePreview = async () => {
    if (!profilePreview) return
    await navigator.clipboard.writeText(JSON.stringify(profilePreview, null, 2))
    toast.success('Runtime profile preview copied')
  }

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Runtime provider profiles
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            UI-side config for OpenAI-compatible local or remote providers.
            These profiles are ready for Codex config generation without
            touching the app-server bridge.
          </p>
        </div>

        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="xs" onClick={startNewProfile}>
              New
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() => applyProfilePreset('ollama')}
            >
              Ollama
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() => applyProfilePreset('llama-cpp')}
            >
              llama.cpp
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() => applyProfilePreset('openai-compatible')}
            >
              OpenAI-compatible
            </Button>
          </div>

          <label className="block space-y-1.5 text-xs">
            <span className="text-muted-foreground">Profile name</span>
            <Input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="Local llama.cpp"
            />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="text-muted-foreground">Base URL</span>
            <Input
              value={profileBaseUrl}
              onChange={(event) => setProfileBaseUrl(event.target.value)}
              placeholder="http://localhost:8080/v1"
            />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="text-muted-foreground">Model</span>
            <Input
              value={profileModel}
              onChange={(event) => setProfileModel(event.target.value)}
              placeholder="qwen3-coder"
            />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="text-muted-foreground">API key env</span>
            <Input
              value={profileApiKeyEnv}
              onChange={(event) => setProfileApiKeyEnv(event.target.value)}
              placeholder="OPENAI_API_KEY"
            />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="text-muted-foreground">Isolated CODEX_HOME</span>
            <div className="flex gap-2">
              <Input
                value={profileCodexHome}
                onChange={(event) => setProfileCodexHome(event.target.value)}
                placeholder=".codex/profiles/local"
              />
              <Button
                variant="outline"
                size="xs"
                className="shrink-0"
                onClick={() => void chooseCodexHomeDirectory()}
              >
                Choose
              </Button>
            </div>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="xs" onClick={saveProfile}>
              {editingProfileId ? 'Update profile' : 'Save profile'}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={profileProbe.loading}
              onClick={() => void probeProfileEndpoint()}
            >
              {profileProbe.loading ? 'Probing' : 'Probe'}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={!activeProfile}
              onClick={() => void writeProfileArtifacts()}
            >
              Write artifacts
            </Button>
          </div>
          {activeProfile && (
            <div className="truncate text-xs text-muted-foreground">
              Active: {activeProfile.name}
            </div>
          )}
        </div>

        {(profileProbe.reachable !== undefined || profileProbe.error) && (
          <div
            className={cn(
              'rounded-md border px-2 py-1.5 text-xs',
              profileProbe.reachable
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-destructive/30 bg-destructive/10 text-destructive'
            )}
          >
            {profileProbe.reachable
              ? `Reachable${profileProbe.statusCode ? ` · HTTP ${profileProbe.statusCode}` : ''}${typeof profileProbe.modelCount === 'number' ? ` · ${profileProbe.modelCount} model${profileProbe.modelCount === 1 ? '' : 's'}` : ''}`
              : profileProbe.error || 'Endpoint not reachable'}
          </div>
        )}

        {profileList.length > 0 && (
          <div className="space-y-2">
            {profileList.map((profile) => (
              <div
                key={profile.id}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs',
                  profile.id === activeProfileId
                    ? 'border-border bg-foreground/5'
                    : 'border-border/60'
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => loadProfileIntoForm(profile.id)}
                >
                  <div className="truncate font-medium text-foreground">
                    {profile.name}
                  </div>
                  <div className="truncate text-muted-foreground">
                    {profile.model} · {profile.baseUrl}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Remove profile"
                  onClick={() => removeProfile(profile.id)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {profilePreview && (
          <div className="rounded-md border bg-foreground/5 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-foreground">
                Launch/config preview
              </div>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void copyProfilePreview()}
              >
                Copy
              </Button>
            </div>
            <pre className="overflow-x-auto text-[11px] text-muted-foreground">
              {JSON.stringify(profilePreview, null, 2)}
            </pre>
          </div>
        )}

        {profileArtifactResult && (
          <div className="rounded-md border bg-foreground/5 p-3">
            <div className="mb-2 text-xs font-medium text-foreground">
              Written artifacts
            </div>
            <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
              <div className="truncate" title={profileArtifactResult.codexHome}>
                CODEX_HOME: {profileArtifactResult.codexHome}
              </div>
              <div
                className="truncate"
                title={profileArtifactResult.manifestPath}
              >
                manifest: {profileArtifactResult.manifestPath}
              </div>
              <div className="truncate" title={profileArtifactResult.envPath}>
                env: {profileArtifactResult.envPath}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Sampling</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Defaults for chat requests and local runtime playgrounds.
          </p>
        </div>
        <SamplerSlider
          label="Temperature"
          value={settings.temperature}
          min={0}
          max={2}
          step={0.05}
          onChange={(temperature) => setSettings({ ...settings, temperature })}
        />
        <SamplerSlider
          label="Top P"
          value={settings.topP}
          min={0}
          max={1}
          step={0.01}
          onChange={(topP) => setSettings({ ...settings, topP })}
        />
        <SamplerSlider
          label="Top K"
          value={settings.topK}
          min={0}
          max={200}
          step={1}
          onChange={(topK) => setSettings({ ...settings, topK })}
        />
        <SamplerSlider
          label="Repeat penalty"
          value={settings.repeatPenalty}
          min={1}
          max={2}
          step={0.01}
          onChange={(repeatPenalty) =>
            setSettings({ ...settings, repeatPenalty })
          }
        />
      </section>

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Generation</h3>
        <label className="block space-y-2 text-sm">
          <span className="text-foreground">Max output tokens</span>
          <Input
            type="number"
            min={0}
            step={1}
            value={settings.maxTokens}
            onChange={(event) =>
              setSettings({
                ...settings,
                maxTokens: Number(event.target.value),
              })
            }
          />
        </label>
        <label className="block space-y-2 text-sm">
          <span className="text-foreground">Seed</span>
          <Input
            type="number"
            step={1}
            value={settings.seed}
            onChange={(event) =>
              setSettings({
                ...settings,
                seed: Number(event.target.value),
              })
            }
          />
        </label>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-foreground">Stream</div>
            <div className="text-xs text-muted-foreground">
              Show tokens as they arrive.
            </div>
          </div>
          <Switch
            checked={settings.stream}
            onCheckedChange={(stream) => setSettings({ ...settings, stream })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-foreground">JSON mode</div>
            <div className="text-xs text-muted-foreground">
              Prefer structured output.
            </div>
          </div>
          <Switch
            checked={settings.jsonMode}
            onCheckedChange={(jsonMode) =>
              setSettings({ ...settings, jsonMode })
            }
          />
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Request shape</h3>
        <pre className="mt-3 overflow-x-auto rounded-md bg-foreground/5 p-3 text-xs text-muted-foreground">
          {JSON.stringify(
            {
              temperature: settings.temperature,
              top_p: settings.topP,
              top_k: settings.topK,
              repeat_penalty: settings.repeatPenalty,
              max_tokens: settings.maxTokens,
              seed: settings.seed,
              stream: settings.stream,
              response_format: settings.jsonMode ? 'json' : 'text',
            },
            null,
            2
          )}
        </pre>
      </section>
    </div>
  )
}

function PanelTabContent({
  type,
  scope,
  onOpenSection,
}: {
  type: ChatSidePanelSection
  scope: ModelToolsPanelScope
  onOpenSection: (section: ChatSidePanelSection) => void
}) {
  const settings = useStudioSettings((state) => state.sampler)
  const setSettings = useStudioSettings((state) => state.setSampler)
  const section = getChatSidePanelSection(type)

  if (type === 'files') {
    return <FilesSection scope={scope} />
  }

  if (type === 'side-chat') {
    return <ChatWorkspaceSection scope={scope} />
  }

  if (type === 'context') {
    return <ContextPickerSection onOpenSection={onOpenSection} />
  }

  if (type === 'model') {
    return (
      <ModelSettingsSection settings={settings} setSettings={setSettings} />
    )
  }

  if (type === 'browser') {
    return <BrowserSection />
  }

  if (type === 'terminal') {
    return <TerminalSection />
  }

  return <PlaceholderSection section={section} />
}

export function ChatSidePanelAddMenuItems({
  onSelect,
  showSeparator = true,
  sectionItems = CHAT_SIDE_PANEL_DROPDOWN_SECTIONS,
}: {
  onSelect?: () => void
  showSeparator?: boolean
  sectionItems?: ChatSidePanelSectionItem[]
}) {
  const openTab = useChatSidePanel((state) => state.openTab)

  return (
    <>
      {showSeparator && <DropdownMenuSeparator />}
      {sectionItems.map((section) => {
        const Icon = section.icon
        return (
          <DropdownMenuItem
            key={section.id}
            onClick={() => {
              openTab(section.id)
              onSelect?.()
            }}
          >
            <Icon className="size-4 text-muted-foreground" />
            <span>{section.label}</span>
          </DropdownMenuItem>
        )
      })}
    </>
  )
}

export function ModelToolsToggle() {
  const open = useChatSidePanel((state) => state.open)
  const toggleOpen = useChatSidePanel((state) => state.toggleOpen)

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="rounded-full"
      aria-label={open ? 'Close side panel' : 'Open side panel'}
      title={open ? 'Close side panel' : 'Open side panel'}
      onClick={toggleOpen}
    >
      <IconLayoutSidebar className="size-4 scale-x-[-1] text-muted-foreground" />
    </Button>
  )
}

function BottomPanelToggle() {
  const open = useWorkspacePanel((state) => state.bottomOpen)
  const toggleOpen = useWorkspacePanel((state) => state.toggleBottomPanel)

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn('rounded-full', open && 'bg-foreground/10 text-foreground')}
      aria-label={open ? 'Close bottom panel' : 'Open bottom panel'}
      aria-pressed={open}
      title={open ? 'Close bottom panel' : 'Open bottom panel'}
      onClick={toggleOpen}
    >
      <PanelBottom
        className={cn(
          'size-4',
          open ? 'text-foreground' : 'text-muted-foreground'
        )}
      />
    </Button>
  )
}

export function ModelToolsDock({
  scope = DEFAULT_PANEL_SCOPE,
}: {
  scope?: ModelToolsPanelScope
}) {
  return (
    <>
      <WorkspacePanelTitlebarControls />
      <ModelToolsPanel scope={scope} />
      <BottomWorkspacePanel />
    </>
  )
}

export function WorkspacePanelsLayout({
  children,
  scope = DEFAULT_PANEL_SCOPE,
  className,
}: {
  children: ReactNode
  scope?: ModelToolsPanelScope
  className?: string
}) {
  const sidePanelOpen = useChatSidePanel((state) => state.open)
  const sidePanelWidth = useChatSidePanel((state) => state.width)
  const bottomPanelOpen = useWorkspacePanel((state) => state.bottomOpen)
  const bottomPanelHeight = useWorkspacePanel((state) => state.bottomHeight)

  return (
    <div
      className={cn(
        'grid h-full min-h-0 min-w-0 overflow-hidden',
        'transition-[grid-template-columns,grid-template-rows] duration-200 ease-out',
        className
      )}
      style={{
        gridTemplateColumns: `minmax(0, 1fr) ${sidePanelOpen ? sidePanelWidth : '0rem'}`,
        gridTemplateRows: `minmax(0, 1fr) ${bottomPanelOpen ? bottomPanelHeight : '0rem'}`,
      }}
    >
      <WorkspacePanelTitlebarControls />
      <div className="min-h-0 min-w-0 overflow-hidden">{children}</div>
      <ModelToolsPanel scope={scope} />
      <BottomWorkspacePanel />
    </div>
  )
}

function WorkspacePanelTitlebarControls() {
  const open = useChatSidePanel((state) => state.open)

  return (
    <div
      className={cn(
        'fixed right-2 top-0 z-[var(--app-layer-workspace-titlebar-controls)] flex h-[var(--app-titlebar-height)] items-center gap-1 transition-opacity duration-150',
        open && 'pointer-events-none opacity-0'
      )}
      aria-hidden={open}
    >
      <BottomPanelToggle />
      <ModelToolsToggle />
    </div>
  )
}

function SidePanelResizeRail({
  width,
  onResize,
  onToggle,
}: {
  width: string
  onResize: (width: string) => void
  onToggle: () => void
}) {
  const railRef = useRef<HTMLButtonElement>(null)
  const { dragRef, handleMouseDown } = useSidebarResize({
    direction: 'left',
    currentWidth: width,
    onResize,
    onToggle,
    isCollapsed: false,
    minResizeWidth: CHAT_SIDE_PANEL_MIN_WIDTH,
    maxResizeWidth: CHAT_SIDE_PANEL_MAX_WIDTH,
    enableAutoCollapse: false,
    enableToggle: false,
    isNested: true,
    widthCookieName: 'chat-side-panel:width',
    widthCookieMaxAge: 60 * 60 * 24 * 7,
  })

  const combinedRef = mergeButtonRefs([railRef, dragRef])

  return (
    <button
      ref={combinedRef}
      type="button"
      aria-label="Resize side panel"
      title="Drag to resize"
      onMouseDown={handleMouseDown}
      className={cn(
        'absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-ew-resize',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2',
        'hover:after:bg-border/80'
      )}
    />
  )
}

export function ModelToolsPanel({
  scope = DEFAULT_PANEL_SCOPE,
}: {
  scope?: ModelToolsPanelScope
}) {
  const open = useChatSidePanel((state) => state.open)
  const width = useChatSidePanel((state) => state.width)
  const setWidth = useChatSidePanel((state) => state.setWidth)
  const setOpen = useChatSidePanel((state) => state.setOpen)
  const [activeSection, setActiveSection] =
    useState<ChatSidePanelSection>('files')

  const selectorSections = [
    getChatSidePanelSection('files'),
    getChatSidePanelSection('context'),
    getChatSidePanelSection('side-chat'),
    getChatSidePanelSection('review'),
    getChatSidePanelSection('terminal'),
    getChatSidePanelSection('browser'),
  ]

  return (
    <aside
      className={cn(
        'relative h-full max-h-full min-h-0 shrink-0 overflow-hidden border-border/60 bg-background',
        'transition-[opacity,transform,border-color] duration-200 ease-out',
        open
          ? 'translate-x-0 border-l opacity-100'
          : 'pointer-events-none translate-x-3 border-l-0 opacity-0'
      )}
      aria-hidden={!open}
      style={{ width }}
    >
      <SidePanelResizeRail
        width={width}
        onResize={setWidth}
        onToggle={() => setOpen(false)}
      />

      <div className="flex h-full min-h-0 min-w-0 flex-col" style={{ width }}>
        <div className="relative z-[var(--app-layer-workspace-titlebar-controls)] flex items-center gap-1 border-b border-border/60 bg-background px-2 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-hide">
            {selectorSections.map((section) => {
              const Icon = section.icon
              const active = section.id === activeSection

              return (
                <Button
                  key={section.id}
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    'shrink-0 rounded-md border border-transparent',
                    active
                      ? 'border-border/80 bg-foreground/10 text-foreground'
                      : 'text-muted-foreground hover:bg-foreground/5'
                  )}
                  aria-label={`Open ${section.label}`}
                  aria-pressed={active}
                  title={section.label}
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon
                    className={cn(
                      'size-3.5',
                      active ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  />
                </Button>
              )
            })}
          </div>
          <BottomPanelToggle />
          <ModelToolsToggle />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-5 pt-3">
          <PanelTabContent
            type={activeSection}
            scope={scope}
            onOpenSection={setActiveSection}
          />
        </div>
      </div>
    </aside>
  )
}

function BottomWorkspacePanel() {
  const open = useWorkspacePanel((state) => state.bottomOpen)
  const activeSection = useWorkspacePanel((state) => state.bottomSection)
  const setSection = useWorkspacePanel((state) => state.setBottomSection)
  const setOpen = useWorkspacePanel((state) => state.setBottomOpen)

  return (
    <section
      aria-hidden={!open}
      className={cn(
        'col-span-2 min-h-0 overflow-hidden border-t border-border/70 bg-background',
        'transition-[opacity,transform,border-color] duration-200 ease-out',
        open
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-2 border-transparent opacity-0'
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2">
          <BottomPanelTab
            section="terminal"
            activeSection={activeSection}
            onSelect={setSection}
          />
          <BottomPanelTab
            section="browser"
            activeSection={activeSection}
            onSelect={setSection}
          />
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon-xs"
            className="rounded-md"
            aria-label="Dismiss bottom panel"
            title="Close"
            onClick={() => setOpen(false)}
          >
            <X className="size-3.5 text-muted-foreground" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {activeSection === 'browser' ? (
            <BrowserSection />
          ) : (
            <TerminalSection />
          )}
        </div>
      </div>
    </section>
  )
}

function BottomPanelTab({
  section,
  activeSection,
  onSelect,
}: {
  section: WorkspaceBottomPanelSection
  activeSection: WorkspaceBottomPanelSection
  onSelect: (section: WorkspaceBottomPanelSection) => void
}) {
  const active = section === activeSection
  const Icon = section === 'terminal' ? Terminal : Globe
  const label = section === 'terminal' ? 'Terminal' : 'Browser'

  return (
    <Button
      variant="ghost"
      size="xs"
      className={cn(
        'h-7 rounded-md border border-transparent px-2',
        active
          ? 'border-border/80 bg-foreground/10 text-foreground'
          : 'text-muted-foreground hover:bg-foreground/5'
      )}
      aria-pressed={active}
      onClick={() => onSelect(section)}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
    </Button>
  )
}

function TerminalSection() {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const scrollbackLoadRef = useRef(0)
  const [starting, setStarting] = useState(false)
  const requestRuntimePermission = useRuntimePermission(
    (state) => state.requestPermission
  )
  const currentThreadId = useThreads((state) => state.currentThreadId)
  const setAttachmentsForThread = useChatAttachments(
    (state) => state.setAttachments
  )
  const attachmentsKey = currentThreadId ?? NEW_THREAD_ATTACHMENT_KEY
  const sessions = useTerminalRuntime((state) => state.sessions)
  const sessionNames = useTerminalRuntime((state) => state.sessionNames)
  const activeSessionId = useTerminalRuntime((state) => state.activeSessionId)
  const activeSession = useTerminalRuntime((state) =>
    state.activeSessionId ? state.sessions[state.activeSessionId] : undefined
  )
  const hydrateSessions = useTerminalRuntime((state) => state.hydrateSessions)
  const upsertSession = useTerminalRuntime((state) => state.upsertSession)
  const setActiveSession = useTerminalRuntime((state) => state.setActiveSession)
  const renameSession = useTerminalRuntime((state) => state.renameSession)
  const markExited = useTerminalRuntime((state) => state.markExited)
  const sessionList = Object.values(sessions).sort(
    (a, b) => b.updatedAt - a.updatedAt
  )

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  const fitAndResize = useCallback(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    const sessionId = activeSessionIdRef.current
    if (!terminal || !fitAddon) return

    try {
      fitAddon.fit()
      if (IS_TAURI && sessionId) {
        void invoke('resize_terminal_session', {
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        })
      }
    } catch (error) {
      console.warn('Failed to resize terminal:', error)
    }
  }, [])

  const startSession = useCallback(async () => {
    if (starting || !IS_TAURI) return

    const allowed = await requestRuntimePermission({
      actionId: 'terminal.start',
      actionLabel: 'start terminal shell',
      category: 'shell',
      resourceLabel: 'local PTY',
      risk: 'high',
      details: {
        shell: 'default login shell',
        cwd: 'workspace default',
      },
    })
    if (!allowed) return

    setStarting(true)
    try {
      const info = await invoke<TerminalSessionInfo>(
        'start_terminal_session',
        {
          request: {
            cols: terminalRef.current?.cols,
            rows: terminalRef.current?.rows,
          },
        }
      )
      upsertSession(info)
      setActiveSession(info.sessionId)
      terminalRef.current?.write('\x1b[2J\x1b[3J\x1b[H')
      terminalRef.current?.writeln(`\x1b[2mStarted ${info.shell}\x1b[0m`)
    } catch (error) {
      terminalRef.current?.writeln(
        `\r\n\x1b[31mFailed to start terminal: ${String(error)}\x1b[0m`
      )
    } finally {
      setStarting(false)
    }
  }, [requestRuntimePermission, setActiveSession, starting, upsertSession])

  const stopSession = useCallback(async () => {
    if (!activeSessionId || !IS_TAURI) return

    const allowed = await requestRuntimePermission({
      actionId: 'terminal.stop',
      actionLabel: 'stop terminal session',
      category: 'shell',
      resourceLabel:
        sessionNames[activeSessionId] ??
        activeSession?.shell ??
        activeSessionId.slice(0, 8),
      risk: 'medium',
      details: {
        sessionId: activeSessionId,
        shell: activeSession?.shell,
        status: activeSession?.status,
      },
    })
    if (!allowed) return

    try {
      await invoke('stop_terminal_session', { sessionId: activeSessionId })
    } catch (error) {
      terminalRef.current?.writeln(
        `\r\n\x1b[31mFailed to stop terminal: ${String(error)}\x1b[0m`
      )
    }
  }, [
    activeSession,
    activeSessionId,
    requestRuntimePermission,
    sessionNames,
  ])

  const attachTerminalOutput = useCallback(async () => {
    const terminal = terminalRef.current
    if (!activeSession || !terminal) return

    let content = terminal.hasSelection() ? terminal.getSelection() : ''
    let captureMode: 'selection' | 'scrollback' = 'selection'

    if (!content.trim()) {
      captureMode = 'scrollback'
      try {
        content = await invoke<string>('read_terminal_scrollback', {
          sessionId: activeSession.sessionId,
        })
      } catch (error) {
        terminal.writeln(
          `\r\n\x1b[31mFailed to read terminal scrollback: ${String(error)}\x1b[0m`
        )
        return
      }
    }

    const trimmedContent = content.replace(ANSI_ESCAPE_PATTERN, '').trim()
    if (!trimmedContent) {
      toast.info('No terminal output to attach')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'terminal.attach-output',
      actionLabel: 'attach terminal output to chat',
      category: 'shell',
      resourceLabel:
        sessionNames[activeSession.sessionId] ?? activeSession.shell,
      risk: 'medium',
      details: {
        sessionId: activeSession.sessionId,
        shell: activeSession.shell,
        captureMode,
        characters: trimmedContent.length,
      },
    })
    if (!allowed) return

    const maxChars = 12000
    const finalContent =
      trimmedContent.length > maxChars
        ? trimmedContent.slice(trimmedContent.length - maxChars)
        : trimmedContent

    setAttachmentsForThread(attachmentsKey, (attachments) => [
      ...attachments,
      createTerminalOutputAttachment({
        sessionId: activeSession.sessionId,
        shell: activeSession.shell,
        cwd: activeSession.cwd,
        status: activeSession.status,
        exitCode: activeSession.exitCode,
        capturedAt: Date.now(),
        captureMode,
        content: finalContent,
      }),
    ])

    toast.success(
      captureMode === 'selection'
        ? 'Terminal selection attached'
        : 'Terminal scrollback attached'
    )
  }, [
    activeSession,
    attachmentsKey,
    requestRuntimePermission,
    sessionNames,
    setAttachmentsForThread,
  ])

  const readActiveScrollback = useCallback(async () => {
    if (!activeSessionId) return ''
    return invoke<string>('read_terminal_scrollback', {
      sessionId: activeSessionId,
    })
  }, [activeSessionId])

  const copyTerminalScrollback = useCallback(async () => {
    if (!activeSession) return

    const content = await readActiveScrollback()
    const trimmedContent = content.replace(ANSI_ESCAPE_PATTERN, '').trim()
    if (!trimmedContent) {
      toast.info('No terminal scrollback to copy')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'terminal.copy-scrollback',
      actionLabel: 'copy terminal scrollback',
      category: 'shell',
      resourceLabel:
        sessionNames[activeSession.sessionId] ?? activeSession.shell,
      risk: 'medium',
      details: {
        sessionId: activeSession.sessionId,
        shell: activeSession.shell,
        characters: trimmedContent.length,
      },
    })
    if (!allowed) return

    await navigator.clipboard.writeText(trimmedContent)
    toast.success('Terminal scrollback copied')
  }, [
    activeSession,
    readActiveScrollback,
    requestRuntimePermission,
    sessionNames,
  ])

  const clearTerminalScreen = useCallback(() => {
    terminalRef.current?.write('\x1b[2J\x1b[3J\x1b[H')
  }, [])

  const reflowTerminal = useCallback(() => {
    fitAndResize()
    toast.success('Terminal reflowed')
  }, [fitAndResize])

  const renameActiveSession = useCallback(() => {
    if (!activeSession) return
    const currentName =
      sessionNames[activeSession.sessionId] ?? activeSession.shell
    const nextName = window.prompt('Terminal session name', currentName)
    if (!nextName) return
    renameSession(activeSession.sessionId, nextName)
  }, [activeSession, renameSession, sessionNames])

  useEffect(() => {
    if (!IS_TAURI) return

    void invoke<TerminalSessionInfo[]>('list_terminal_sessions')
      .then((nextSessions) => {
        hydrateSessions(nextSessions)
      })
      .catch((error) => {
        console.warn('Failed to list terminal sessions:', error)
      })
  }, [hydrateSessions])

  useEffect(() => {
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      theme: {
        background: '#0b0f14',
        foreground: '#d7dde8',
        cursor: '#d7dde8',
        selectionBackground: '#334155',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.loadAddon(new SearchAddon())
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    if (containerRef.current) {
      terminal.open(containerRef.current)
      fitAndResize()
      terminal.writeln(
        '\x1b[2mTerminal ready. Start or select a session to attach a PTY.\x1b[0m'
      )
    }

    const disposable = terminal.onData((data) => {
      const sessionId = activeSessionIdRef.current
      if (!IS_TAURI || !sessionId) return
      void invoke('write_terminal_stdin', {
        sessionId,
        input: data,
      })
    })

    return () => {
      disposable.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [fitAndResize])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return

    const loadId = scrollbackLoadRef.current + 1
    scrollbackLoadRef.current = loadId
    terminal.write('\x1b[2J\x1b[3J\x1b[H')

    if (!activeSessionId) {
      terminal.writeln(
        '\x1b[2mNo terminal session selected. Start a new session to attach a PTY.\x1b[0m'
      )
      return
    }
    if (!IS_TAURI) return

    void invoke<string>('read_terminal_scrollback', {
      sessionId: activeSessionId,
    })
      .then((scrollback) => {
        if (scrollbackLoadRef.current !== loadId) return
        terminal.write('\x1b[2J\x1b[3J\x1b[H')
        if (scrollback) {
          terminal.write(scrollback)
        } else if (activeSession) {
          terminal.writeln(`\x1b[2mAttached to ${activeSession.shell}\x1b[0m`)
        }
        fitAndResize()
      })
      .catch((error) => {
        if (scrollbackLoadRef.current !== loadId) return
        terminal.writeln(
          `\r\n\x1b[31mFailed to load terminal scrollback: ${String(error)}\x1b[0m`
        )
      })
  }, [activeSession, activeSessionId, fitAndResize])

  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => fitAndResize())
    if (containerRef.current) resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [fitAndResize])

  useEffect(() => {
    if (!IS_TAURI) return

    let unlistenOutput: (() => void) | undefined
    let unlistenExit: (() => void) | undefined
    let unlistenError: (() => void) | undefined

    void listen<{ sessionId: string; data: string }>(
      'terminal-output',
      (event) => {
        if (event.payload.sessionId === activeSessionIdRef.current) {
          terminalRef.current?.write(event.payload.data)
        }
      }
    ).then((unlisten) => {
      unlistenOutput = unlisten
    })

    void listen<{ sessionId: string; exitCode?: number | null }>(
      'terminal-exit',
      (event) => {
        markExited(event.payload.sessionId, event.payload.exitCode)
        if (event.payload.sessionId === activeSessionIdRef.current) {
          terminalRef.current?.writeln(
            `\r\n\x1b[2mProcess exited${typeof event.payload.exitCode === 'number' ? ` (${event.payload.exitCode})` : ''}.\x1b[0m`
          )
        }
      }
    ).then((unlisten) => {
      unlistenExit = unlisten
    })

    void listen<{ sessionId: string; message: string }>(
      'terminal-error',
      (event) => {
        if (event.payload.sessionId === activeSessionIdRef.current) {
          terminalRef.current?.writeln(
            `\r\n\x1b[31m${event.payload.message}\x1b[0m`
          )
        }
      }
    ).then((unlisten) => {
      unlistenError = unlisten
    })

    return () => {
      unlistenOutput?.()
      unlistenExit?.()
      unlistenError?.()
    }
  }, [markExited])

  if (!IS_TAURI) {
    return (
      <div className="flex h-full min-h-[180px] items-center justify-center rounded-md border border-border/60 bg-card px-4 text-center text-sm text-muted-foreground">
        Terminal sessions are available in the desktop app.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[180px] flex-col overflow-hidden rounded-md border border-border/60 bg-[#0b0f14]">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-white/10 px-2">
        <div className="min-w-0 flex-1 truncate font-mono text-xs text-slate-300">
          {activeSession
            ? `${sessionNames[activeSession.sessionId] ?? activeSession.shell}${activeSession.status === 'running' ? '' : ' · exited'}`
            : 'No terminal session'}
        </div>
        {sessionList.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="xs">
                Sessions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 min-w-64">
              {sessionList.map((session) => (
                <DropdownMenuItem
                  key={session.sessionId}
                  onClick={() => setActiveSession(session.sessionId)}
                >
                  <Terminal className="size-4" />
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs">
                      {sessionNames[session.sessionId] ?? session.shell}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {session.status}
                      {session.cwd ? ` · ${session.cwd}` : ''}
                    </div>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="secondary"
          size="xs"
          disabled={!activeSession}
          title={
            activeSession
              ? 'Attach selected output, or latest scrollback if nothing is selected'
              : 'Start a terminal session first'
          }
          onClick={() => void attachTerminalOutput()}
        >
          <Paperclip className="size-3.5" />
          Attach
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon-xs" title="Terminal actions">
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuItem onClick={() => void startSession()}>
              <Terminal className="size-4" />
              <span>New shell</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!activeSession}
              onClick={() => void attachTerminalOutput()}
            >
              <Paperclip className="size-4" />
              <span>Attach selection/scrollback</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!activeSession}
              onClick={() => void copyTerminalScrollback()}
            >
              <Copy className="size-4" />
              <span>Copy scrollback</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!activeSession}
              onClick={clearTerminalScreen}
            >
              <Trash2 className="size-4" />
              <span>Clear screen</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!activeSession}
              onClick={reflowTerminal}
            >
              <RefreshCw className="size-4" />
              <span>Resize/reflow</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!activeSession}
              onClick={renameActiveSession}
            >
              <File className="size-4" />
              <span>Rename session</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={activeSession?.status !== 'running'}
              onClick={() => void stopSession()}
            >
              <X className="size-4" />
              <span>Kill session</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {activeSession?.status === 'running' ? (
          <Button variant="secondary" size="xs" onClick={stopSession}>
            Stop
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="xs"
            disabled={starting}
            onClick={() => void startSession()}
          >
            {starting ? 'Starting' : activeSession ? 'New' : 'Start'}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 p-2">
        <div ref={containerRef} className="h-full min-h-0 w-full" />
      </div>
    </div>
  )
}
