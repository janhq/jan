import { createFileRoute } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import {
  AlignLeft,
  Clipboard,
  EyeOff,
  FileText,
  FolderOpen,
  GitPullRequest,
  MoreHorizontal,
  RefreshCw,
  Upload,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import HeaderPage from '@/containers/HeaderPage'
import { useServiceHub } from '@/hooks/useServiceHub'
import { cn } from '@/lib/utils'
import {
  type WorkspaceDirectoryScope,
  useWorkspaceDirectories,
} from '@/stores/workspace-directory-store'

type GitReviewFile = {
  path: string
  status: string
  additions: number
  deletions: number
}

type GitReviewStatus = {
  cwd: string
  branch?: string
  additions: number
  deletions: number
  files: GitReviewFile[]
}

const REVIEW_SCOPE: WorkspaceDirectoryScope = {
  id: 'review',
  type: 'workspace',
  label: 'Review',
}

export const Route = createFileRoute('/review')({
  component: Review,
})

function statusLabel(status: string) {
  if (status.includes('?')) return 'Untracked'
  if (status.includes('A')) return 'Added'
  if (status.includes('D')) return 'Deleted'
  if (status.includes('R')) return 'Renamed'
  if (status.includes('M')) return 'Modified'
  return status || 'Changed'
}

function Review() {
  const serviceHub = useServiceHub()
  const workspacePath = useWorkspaceDirectories((state) =>
    state.getDirectory(REVIEW_SCOPE)
  )
  const setWorkspacePath = useWorkspaceDirectories((state) => state.setDirectory)
  const [status, setStatus] = useState<GitReviewStatus | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [hideWhitespace, setHideWhitespace] = useState(false)

  const cwd = workspacePath || '.'

  const selectedFile = useMemo(
    () => status?.files.find((file) => file.path === selectedPath),
    [selectedPath, status?.files]
  )

  const loadStatus = async () => {
    setLoading(true)
    setError(null)
    try {
      const nextStatus = await invoke<GitReviewStatus>('git_review_status', {
        cwd,
      })
      setStatus(nextStatus)
      setSelectedPath((previous) => {
        if (previous && nextStatus.files.some((file) => file.path === previous)) {
          return previous
        }
        return nextStatus.files[0]?.path ?? null
      })
    } catch (err) {
      setStatus(null)
      setSelectedPath(null)
      setDiff('')
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  useEffect(() => {
    if (!selectedPath) {
      setDiff('')
      return
    }

    void invoke<string>('git_review_diff', {
      cwd,
      path: selectedPath,
    })
      .then(setDiff)
      .catch((err) => {
        setDiff('')
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [cwd, selectedPath])

  const chooseWorkspace = async () => {
    const selection = await serviceHub.dialog().open({
      directory: true,
      multiple: false,
    })
    if (typeof selection === 'string' && selection.trim()) {
      setWorkspacePath(REVIEW_SCOPE, selection)
    }
  }

  const copyGitApplyCommand = async () => {
    const fileArg = selectedPath ? ` -- ${selectedPath}` : ''
    await navigator.clipboard.writeText(`git -C "${cwd}" diff HEAD${fileArg} | git apply`)
    toast.success('Copied git apply command')
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <HeaderPage>
        <div className="flex w-full items-center gap-2 pr-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">Review</span>
              {status?.branch && (
                <span className="truncate text-muted-foreground">
                  {status.branch}
                </span>
              )}
              {status && (
                <span className="text-muted-foreground">
                  <span className="text-emerald-500">+{status.additions}</span>{' '}
                  <span className="text-red-500">-{status.deletions}</span>
                </span>
              )}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {workspacePath || 'No workspace selected'}
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled
            title="Commit and push flow is not connected yet"
          >
            <Upload />
            Commit or push
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled
            title="Create PR flow is not connected yet"
          >
            <GitPullRequest />
            Create PR
          </Button>
        </div>
      </HeaderPage>

      <div className="flex min-h-0 flex-1 border-t">
        <aside className="flex w-80 shrink-0 flex-col border-r bg-sidebar/40">
          <div className="flex h-11 items-center gap-1 border-b px-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void loadStatus()}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw className={cn(loading && 'animate-spin')} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={chooseWorkspace}
              title="Choose workspace folder"
            >
              <FolderOpen />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" title="Review options">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuItem onSelect={() => void loadStatus()}>
                  <RefreshCw />
                  Refresh
                </DropdownMenuItem>
                <DropdownMenuCheckboxItem
                  checked={wrap}
                  onCheckedChange={(checked) => setWrap(!!checked)}
                >
                  <AlignLeft />
                  Enable word wrap
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={collapsed}
                  onCheckedChange={(checked) => setCollapsed(!!checked)}
                >
                  <FileText />
                  Collapse all diffs
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={hideWhitespace}
                  onCheckedChange={(checked) => setHideWhitespace(!!checked)}
                >
                  <EyeOff />
                  Hide white space
                </DropdownMenuCheckboxItem>
                <DropdownMenuItem onSelect={copyGitApplyCommand}>
                  <Clipboard />
                  Copy git apply command
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : status?.files.length ? (
              <div className="space-y-1">
                {status.files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    className={cn(
                      'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-sidebar-foreground/8',
                      selectedPath === file.path && 'bg-sidebar-accent'
                    )}
                    onClick={() => setSelectedPath(file.path)}
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{file.path}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {statusLabel(file.status)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No changes found.
              </div>
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 items-center gap-3 border-b px-4 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {selectedFile?.path ?? 'Select a changed file'}
            </span>
            {selectedFile && (
              <span className="text-xs text-muted-foreground">
                <span className="text-emerald-500">+{selectedFile.additions}</span>{' '}
                <span className="text-red-500">-{selectedFile.deletions}</span>
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-[#111] text-[13px] leading-5 text-neutral-200">
            {collapsed ? (
              <div className="m-4 rounded-md bg-white/10 px-3 py-2 text-muted-foreground">
                Diff collapsed
              </div>
            ) : diff ? (
              <pre
                className={cn(
                  'min-h-full p-4 font-mono',
                  wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
                )}
              >
                {hideWhitespace ? diff.replace(/[ \t]+$/gm, '') : diff}
              </pre>
            ) : (
              <div className="p-4 text-muted-foreground">
                {loading ? 'Loading diff...' : 'No diff to show.'}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
