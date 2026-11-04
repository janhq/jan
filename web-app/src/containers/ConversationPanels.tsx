import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { UIMessage } from 'ai'
import { AnimatePresence } from 'motion/react'
import { FileDiff, FileText, ListChecks, Network, PanelRight } from 'lucide-react'
import { threadWorkspacePath } from '@janhq/tauri-plugin-agent-tools-api'
import { Button } from '@/components/ui/button'
import { CoworkDiffPanel } from '@/containers/CoworkDiffPanel'
import { CoworkOverviewPanel } from '@/containers/CoworkOverviewPanel'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { CoworkFilesPanel } from '@/containers/CoworkFilesPanel'
import { ChatPreviewPanel } from '@/containers/ChatPreviewPanel'
import { CoworkTasksPanel } from '@/containers/CoworkTasksPanel'
import { CoworkTodoPanel } from '@/containers/CoworkTodoPanel'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/useThreads'
import { useToolCallRuntime } from '@/hooks/useToolCallRuntime'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  availableConversationPanels,
  CONVERSATION_PANEL_ORDER,
  isPermittedPath,
  projectConversationPanels,
  resolvePanelPath,
  threadRuntimeDiffs,
  type PanelRoots,
  type ConversationPanelContent,
  type ConversationPanelKind,
} from '@/lib/conversationPanels'
import { DIFF_ADD_TEXT, DIFF_DEL_TEXT } from '@/lib/coworkDiffs'
import { cn } from '@/lib/utils'

/** One rail, one panel. `preview` is reached from the files panel, never
 * directly from a control. */
export type ConversationRail =
  | { kind: ConversationPanelKind }
  | { kind: 'preview'; path: string }

const ICONS = {
  todos: ListChecks,
  tasks: Network,
  files: FileText,
  diff: FileDiff,
} as const

/** Controls exist only for panels with settled content. Nothing renders (not
 * even the row) when there is nothing relevant, so no mode or selector shows. */
export function ConversationPanelControls({
  content,
  active,
  onToggle,
  panelId,
}: {
  content: ConversationPanelContent
  active: ConversationPanelKind | null
  onToggle: (kind: ConversationPanelKind) => void
  panelId: string
}) {
  const { t } = useTranslation()
  const available = availableConversationPanels(content)
  const kinds = CONVERSATION_PANEL_ORDER.filter((kind) => available[kind])
  if (kinds.length === 0) return null

  const additions = content.diffs.reduce((sum, file) => sum + file.additions, 0)
  const deletions = content.diffs.reduce((sum, file) => sum + file.deletions, 0)
  const label = (kind: ConversationPanelKind) =>
    kind === 'todos'
      ? t('common:todoPanelTitle')
      : kind === 'tasks'
        ? t('common:backgroundTasks')
        : kind === 'files'
          ? t('common:overview.files')
          : t('common:changes.title')

  return (
    <div role="toolbar" aria-label={t('common:overview.title')} className="flex min-w-0 flex-wrap items-center gap-1">
      {kinds.map((kind) => {
        const Icon = ICONS[kind]
        const open = active === kind
        return (
          <Button
            key={kind}
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={() => onToggle(kind)}
            className={cn(
              'max-w-full shrink-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
              open ? 'bg-main-view-fg/10 text-primary' : 'text-muted-foreground'
            )}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="max-sm:sr-only truncate">{label(kind)}</span>
            {kind === 'diff' && (
              <>
                <span className={cn('font-mono tabular-nums', DIFF_ADD_TEXT)}>+{additions}</span>
                <span className={cn('font-mono tabular-nums', DIFF_DEL_TEXT)}>-{deletions}</span>
              </>
            )}
          </Button>
        )
      })}
    </div>
  )
}

/** Escape closes the rail from anywhere inside it unless a nested menu owns it. */
function closeOnEscape(onClose: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    if (document.querySelector('[data-state="open"][role="menu"], [data-state="open"][data-slot="popover-content"]')) return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }
}

/** The single side panel. Roots only filter what the UI offers; every read goes
 * through the host's thread-scoped read, which is the authority. */
export function ConversationPanelRail({
  threadId,
  rail,
  content,
  roots,
  panelId,
  onSelect,
  onClose,
}: {
  threadId: string
  rail: ConversationRail | null
  content: ConversationPanelContent
  roots: PanelRoots
  panelId: string
  onSelect: (rail: ConversationRail) => void
  onClose: () => void
}) {
  let panel: ReactNode = null
  if (rail?.kind === 'todos') panel = <CoworkTodoPanel todos={content.todos} onClose={onClose} />
  else if (rail?.kind === 'tasks') panel = <CoworkTasksPanel subagents={content.tasks} onClose={onClose} />
  else if (rail?.kind === 'diff') panel = <CoworkDiffPanel files={content.diffs} onClose={onClose} />
  else if (rail?.kind === 'files')
    panel = (
      <CoworkFilesPanel
        attachments={[]}
        artifacts={content.artifacts}
        onPreview={(path) => {
          // Refuse before the panel ever sees an out-of-root path.
          if (isPermittedPath(roots, path)) onSelect({ kind: 'preview', path })
        }}
        onClose={onClose}
      />
    )
  else if (rail?.kind === 'preview') {
    // Validated before mount, so an injected or stale rail state can never make
    // the preview read a path outside the roots, even for one render.
    const abs = resolvePanelPath(roots, rail.path)
    if (abs)
      panel = (
        <ChatPreviewPanel
          key={`${threadId}\n${abs}`}
          threadId={threadId}
          path={abs}
          onClose={() => onSelect({ kind: 'files' })}
        />
      )
  }

  return (
    <AnimatePresence initial={false}>
      {panel && (
        <div
          key="conversation-rail"
          id={panelId}
          // No box of its own: the panel lays out in (and measures) the content row.
          className="contents"
          tabIndex={-1}
          onKeyDown={closeOnEscape(onClose)}
        >
          {panel}
        </div>
      )}
    </AnimatePresence>
  )
}

/** Preview roots: the thread's scratch sandbox plus the consented folder.
 * Both are only UI candidates; the host's scoped read stays authoritative. The
 * scratch path is keyed by thread so a switch never exposes the previous
 * thread's root for even one render. */
export function useConversationRoots(
  threadId: string,
  folderPath: string | null | undefined
): PanelRoots {
  const [scratch, setScratch] = useState<{ threadId: string; path: string } | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const dataFolder = await getServiceHub().app().getJanDataFolder()
        if (!dataFolder) return
        const path = await threadWorkspacePath(dataFolder, threadId)
        if (live) setScratch({ threadId, path })
      } catch {
        /* No scratch path means no preview root: fail closed. */
      }
    })()
    return () => {
      live = false
    }
  }, [threadId])
  const scratchPath = scratch?.threadId === threadId ? scratch.path : null
  return useMemo(
    () => ({ scratch: scratchPath, folder: folderPath ?? null }),
    [scratchPath, folderPath]
  )
}

/** Derives panel content from the thread's messages and owns the rail state. */
export function useConversationPanels({
  threadId,
  messages,
}: {
  threadId: string
  messages: readonly UIMessage[]
}): { controls: ReactNode; rail: ReactNode; toggle: ReactNode; overview: ReactNode; overviewSpacer: ReactNode } {
  const { t } = useTranslation()
  const desktopOverview = useMediaQuery('(min-width: 1280px)', true)
  const [overviewOpen, setOverviewOpen] = useState(true)
  const [overviewRequested, setOverviewRequested] = useState(false)
  const panelId = useId()
  const [requested, setRequested] = useState<{ threadId: string; rail: ConversationRail | null }>({ threadId, rail: null })
  // Effective (overlay) grant, re-derived on every store notification so a
  // revoke drops the folder root immediately. A primitive: stable by value.
  const folderPath = useThreads(
    (state) => state.getConversationCapabilities(threadId).folderScope?.path ?? null
  )
  // Only diffs of calls this thread's loop owns: call IDs repeat across threads.
  const runtimeDiffs = useToolCallRuntime(
    useShallow((s) => threadRuntimeDiffs(s.diffs, s.timings, threadId))
  )
  const roots = useConversationRoots(threadId, folderPath)
  const content = useMemo(
    () => projectConversationPanels(messages, roots, runtimeDiffs),
    [messages, roots, runtimeDiffs]
  )
  const available = availableConversationPanels(content)
  const requestedRail = requested.threadId === threadId ? requested.rail : null
  // A panel whose content disappears (thread switch, rewind) closes itself.
  const rail =
    requestedRail &&
    (requestedRail.kind === 'preview'
      ? isPermittedPath(roots, requestedRail.path)
      : available[requestedRail.kind])
      ? requestedRail
      : null
  // The derived `rail` above only hides an unavailable request. Forget the
  // request itself so a later re-grant or returning content cannot reopen it.
  // Cleared in an effect (never during render), and only if the state is still
  // the exact request that was judged stale, so a newer user request is never
  // overwritten by a late compare.
  useEffect(() => {
    if (requested.rail === null || rail !== null) return
    setRequested((current) => (current === requested ? { threadId, rail: null } : current))
  }, [requested, rail, threadId])
  const set = (next: ConversationRail | null) => setRequested({ threadId, rail: next })
  const active = rail && rail.kind !== 'preview' ? rail.kind : rail ? 'files' : null
  const hasControls = CONVERSATION_PANEL_ORDER.some((kind) => available[kind])
  // The overview is the old Cowork page's always-available right rail. A docked
  // panel (files/diff/todos/tasks/preview) replaces it, as it did there.
  const docked = rail !== null
  const overviewShown = overviewOpen && !docked
  const toggleOverview = () => {
    setOverviewRequested(true)
    if (!desktopOverview && !overviewRequested) { set(null); setOverviewOpen(true); return }
    if (docked) { set(null); setOverviewOpen(true) }
    else setOverviewOpen((open) => !open)
  }
  const openRail = (next: ConversationRail) => { setOverviewOpen(false); set(next) }

  return {
    toggle: (
      <button
        type="button"
        aria-label={t(overviewShown ? 'common:overview.close' : 'common:overview.title')}
        data-testid="overview-toggle"
        aria-pressed={overviewShown}
        onClick={toggleOverview}
        className={cn(
          'ml-auto flex size-8 shrink-0 items-center justify-center rounded-full bg-muted/70 text-muted-foreground transition-[margin,background-color,color] duration-250 ease-out motion-reduce:transition-none hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          overviewShown && 'xl:mr-80'
        )}
      >
        <PanelRight className="size-4" />
      </button>
    ),
    overviewSpacer: (
      <div
        className={cn(
          'hidden shrink-0 transition-[width] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none xl:block',
          overviewShown ? 'w-80' : 'w-0'
        )}
        aria-hidden="true"
      />
    ),
    overview: (
      <AnimatePresence initial={false}>
        {overviewShown && (desktopOverview || overviewRequested) && (
          <CoworkOverviewPanel
            todos={content.todos}
            attachments={[]}
            artifacts={content.artifacts}
            files={content.diffs}
            subagents={content.tasks}
            onPreview={(path) => { if (isPermittedPath(roots, path)) openRail({ kind: 'preview', path }) }}
            onChanges={() => openRail({ kind: 'diff' })}
            onAgents={() => openRail({ kind: 'tasks' })}
            onClose={() => setOverviewOpen(false)}
          />
        )}
      </AnimatePresence>
    ),
    // No available kind means no element at all, not an empty wrapper, so the
    // caller's own `controls &&` guard and spacing stay correct.
    controls: hasControls ? (
      <ConversationPanelControls
        content={content}
        active={active}
        panelId={panelId}
        onToggle={(kind) => set(active === kind ? null : { kind })}
      />
    ) : null,
    rail: (
      <ConversationPanelRail
        threadId={threadId}
        rail={rail}
        content={content}
        roots={roots}
        panelId={panelId}
        onSelect={set}
        onClose={() => set(null)}
      />
    ),
  }
}
