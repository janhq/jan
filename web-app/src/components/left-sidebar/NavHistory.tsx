import { memo, useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroupAction,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { route } from '@/constants/routes'
import { isDeletedByDeleteAll, useThreads } from '@/hooks/useThreads'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useCoworkSessions, type CoworkSession } from '@/hooks/useCoworkSessions'
import { useCoworkRun, useIsSessionActive } from '@/hooks/useCoworkRun'
import { stopAgentSessionMonitors } from '@/lib/agentTools'
import { dropMonitorLane } from '@/lib/coworkMonitor'
import { ThreadItem } from '@/containers/ThreadList'
import { RenameThreadDialog } from '@/containers/dialogs/RenameThreadDialog'
import { DeleteAllThreadsDialog } from '@/containers/dialogs/DeleteAllThreadsDialog'
import { mergeHistory } from '@/lib/mergeHistory'

/**
 * One history for every conversation: chat threads (outside projects) and
 * Cowork sessions in a single list, newest first, with a mode icon per row. It
 * replaces the Home/Cowork tabs and the route-based sidebar swap.
 */

const CoworkRow = memo(function CoworkRow({
  session,
  isCurrent,
  isMobile,
  onRequestDelete,
}: {
  session: CoworkSession
  isCurrent: boolean
  isMobile: boolean
  onRequestDelete: (pending: { id: string; title: string }) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isRunning = useIsSessionActive(session.id)
  const [renameOpen, setRenameOpen] = useState(false)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isCurrent}
        className="data-[active=true]:bg-sidebar-foreground/10 dark:data-[active=true]:bg-sidebar-accent"
        data-testid={`history-cowork-${session.id}`}
        onClick={() =>
          navigate({
            to: route.coworkSession,
            params: { sessionId: session.id },
          })
        }
      >
        {isRunning && (
          <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
        )}
        <span className="truncate" title={session.title}>
          {session.title}
        </span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover className="hover:bg-sidebar-foreground/8">
            <MoreHorizontal />
            <span className="sr-only">{t('common:sidebar.more')}</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-48"
          side={isMobile ? 'bottom' : 'right'}
          align={isMobile ? 'end' : 'start'}
        >
          {/* Persistence refuses writes for an unavailable session, so a rename
              would look saved and revert on restart. */}
          {!session.unavailable && (
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil />
              <span>{t('common:rename')}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => onRequestDelete({ id: session.id, title: session.title })}
          >
            <Trash2 />
            <span>{t('common:deleteSession')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameThreadDialog
        // The dialog only reads the id; the title is persisted through the
        // session store, which writes it to the session's thread.json.
        thread={{ id: session.id, title: session.title } as Thread}
        plainTitleForRename={session.title}
        onRename={(id, title) => useCoworkSessions.getState().setTitle(id, title)}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        withoutTrigger
      />
    </SidebarMenuItem>
  )
})

export function NavHistory() {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const threads = useThreads((s) => s.threads)
  const isLoadingThreads = useThreads((s) => s.isLoadingThreads)
  const deleteAllThreads = useThreads((s) => s.deleteAllThreads)
  const { folders, foldersLoaded } = useThreadManagement()
  const sessions = useCoworkSessions((s) => s.sessions)
  const runIds = useCoworkRun((s) => s.runId)
  // The active row follows the URL, not a lingering store selection.
  const activeSessionId = useParams({
    strict: false,
    select: (p) => (p as { sessionId?: string }).sessionId,
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)

  const rows = useMemo(
    () =>
      mergeHistory(
        Object.values(threads).filter((t) => t.id !== 'temporary-chat'),
        sessions,
        runIds,
        foldersLoaded ? new Set(folders.map((f) => f.id)) : null
      ),
    [threads, sessions, runIds, folders, foldersLoaded]
  )

  const confirmDelete = useCallback(() => {
    if (pendingDelete) {
      const sid = pendingDelete.id
      // Watchers belong to the session, so they go with it.
      void stopAgentSessionMonitors(sid)
      dropMonitorLane(sid)
      useCoworkRun.getState().clearMonitors(sid)
      useCoworkSessions.getState().deleteSession(sid)
      // Deleting the conversation on screen must leave its route, as deleting a
      // chat thread does; otherwise the page sits on a dead id.
      if (sid === activeSessionId) navigate({ to: route.home })
    }
    setPendingDelete(null)
  }, [pendingDelete, activeSessionId, navigate])

  if (rows.length === 0) {
    if (!isLoadingThreads) return null
    return (
      <SidebarGroup className="px-1 group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>{t('common:chatsAndTasks')}</SidebarGroupLabel>
        <div className="flex items-center justify-center py-2">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      </SidebarGroup>
    )
  }

  // Offer Delete All only when it would actually delete something.
  const chatThreadCount = rows.filter(
    (r) => r.kind === 'chat' && isDeletedByDeleteAll(r.thread)
  ).length

  return (
    <SidebarGroup className="px-1 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{t('common:chatsAndTasks')}</SidebarGroupLabel>
      {chatThreadCount > 1 && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarGroupAction className="hover:bg-sidebar-foreground/8">
              <MoreHorizontal className="text-muted-foreground" />
              <span className="sr-only">{t('common:sidebar.more')}</span>
            </SidebarGroupAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DeleteAllThreadsDialog
              onDeleteAll={deleteAllThreads}
              onDropdownClose={() => setMenuOpen(false)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <SidebarMenu>
        {rows.map((row) =>
          row.kind === 'cowork' ? (
            <CoworkRow
              key={row.id}
              session={row.session}
              isCurrent={row.id === activeSessionId}
              isMobile={isMobile}
              onRequestDelete={setPendingDelete}
            />
          ) : (
            // Chat rows keep ThreadList's item (rename, move to project, delete).
            <ThreadItem key={row.id} thread={row.thread} isMobile={isMobile} />
          )
        )}
      </SidebarMenu>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('common:deleteSessionTitle')}</DialogTitle>
            <DialogDescription>
              {t('common:deleteSessionBody', { title: pendingDelete?.title })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
              {t('common:cancel')}
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmDelete}>
              {t('common:delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarGroup>
  )
}
