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
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useCoworkRun, useIsSessionActive } from '@/hooks/useCoworkRun'
import { deleteCoworkConversation, hasCoworkSession } from '@/lib/coworkDelete'
import { isCoworkThread } from '@/lib/threadMode'
import { ThreadItem } from '@/containers/ThreadList'
import { RenameThreadDialog } from '@/containers/dialogs/RenameThreadDialog'
import { DeleteAllThreadsDialog } from '@/containers/dialogs/DeleteAllThreadsDialog'
import { mergeHistory } from '@/lib/mergeHistory'
import { canOpenCoworkSession } from '@/lib/coworkOpenable'
import { isCoworkEnabled } from '@/lib/version'
import { toast } from 'sonner'

/**
 * One history for every conversation, newest first. It replaces the Home/Cowork
 * tabs, the chat list and the separate Cowork session list.
 *
 * A Cowork conversation is a thread too (coworkSync mirrors it into the thread
 * list), so it is listed once, from `useThreads`, and opens `/cowork/$sessionId`.
 * `mergeHistory` adds a session-store row only for a conversation with no thread
 * yet (a first run still streaming) or whose thread is gone.
 */

type PendingDelete = { id: string; title: string; collision: boolean }

const CoworkRow = memo(function CoworkRow({
  id,
  title,
  unavailable,
  isCurrent,
  isMobile,
  onRequestDelete,
}: {
  id: string
  title: string
  unavailable?: string
  isCurrent: boolean
  isMobile: boolean
  onRequestDelete: (pending: PendingDelete) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isRunning = useIsSessionActive(id)
  const [renameOpen, setRenameOpen] = useState(false)
  const displayTitle = title || t('common:newThread')
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isCurrent}
        className="data-[active=true]:bg-sidebar-foreground/10 dark:data-[active=true]:bg-sidebar-accent"
        data-testid={`history-cowork-${id}`}
        onClick={() => {
          // The route would redirect home for these; say why instead.
          if (!canOpenCoworkSession(id)) {
            toast.error(t('common:coworkSessionUnavailable'))
            return
          }
          navigate({
            to: route.coworkSession,
            params: { sessionId: id },
          })
        }}
      >
        {isRunning && (
          <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
        )}
        <span className="truncate" title={displayTitle}>
          {displayTitle}
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
          {!unavailable && (
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil />
              <span>{t('common:rename')}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            onSelect={() =>
              onRequestDelete({
                id,
                title: displayTitle,
                collision: unavailable === 'id-collision',
              })
            }
          >
            <Trash2 />
            <span>{t('common:deleteSession')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameThreadDialog
        // The dialog only reads the id. A live session persists its title (and
        // the mirrored thread follows); a thread without a session in the store
        // is renamed through the thread list.
        thread={{ id, title } as Thread}
        plainTitleForRename={title}
        onRename={(threadId, next) => {
          if (hasCoworkSession(threadId)) {
            useCoworkSessions.getState().setTitle(threadId, next)
          } else {
            useThreads.getState().renameThread(threadId, next)
          }
        }}
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
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const coworkEnabled = isCoworkEnabled()
  const rows = useMemo(() => {
    const merged = mergeHistory(
      Object.values(threads).filter((t) => t.id !== 'temporary-chat'),
      sessions,
      runIds,
      foldersLoaded ? new Set(folders.map((f) => f.id)) : null
    )
    // Without Cowork there is no page to open these rows on; they stay on disk
    // and show up again on a build that ships it.
    return coworkEnabled
      ? merged
      : merged.filter((r) => r.kind === 'thread' && !isCoworkThread(r.thread))
  }, [threads, sessions, runIds, folders, foldersLoaded, coworkEnabled])

  const confirmDelete = useCallback(() => {
    if (pendingDelete) {
      const { id, collision } = pendingDelete
      if (collision) {
        // A collision placeholder shares its id with an unrelated chat: remove
        // only the placeholder, and never stop that chat's run or shell.
        useCoworkSessions.getState().deleteSession(id)
      } else if (hasCoworkSession(id)) {
        // Stops the run, its shell and its watchers, then removes the session
        // through the store so coworkSync journals it and deletes the thread.
        deleteCoworkConversation(id)
      } else {
        useThreads.getState().deleteThread(id)
      }
      // Deleting the conversation on screen must leave its route, as deleting a
      // chat thread does; otherwise the page sits on a dead id.
      if (id === activeSessionId) navigate({ to: route.home })
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
  const deletableCount = rows.filter(
    (r) => r.kind === 'thread' && isDeletedByDeleteAll(r.thread)
  ).length

  return (
    <SidebarGroup className="px-1 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{t('common:chatsAndTasks')}</SidebarGroupLabel>
      {deletableCount > 1 && (
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
        {rows.map((row) => {
          if (row.kind === 'session') {
            return (
              <CoworkRow
                key={`session:${row.id}`}
                id={row.id}
                title={row.session.title}
                unavailable={row.session.unavailable}
                isCurrent={row.id === activeSessionId}
                isMobile={isMobile}
                onRequestDelete={setPendingDelete}
              />
            )
          }
          if (isCoworkThread(row.thread)) {
            // The session store is the authority for what is live; the mirror
            // thread supplies the row while the session is not loaded.
            const session = sessions.find((s) => s.id === row.id)
            return (
              <CoworkRow
                key={`thread:${row.id}`}
                id={row.id}
                title={session?.title ?? row.thread.title}
                unavailable={session?.unavailable}
                isCurrent={row.id === activeSessionId}
                isMobile={isMobile}
                onRequestDelete={setPendingDelete}
              />
            )
          }
          // Chat rows keep ThreadList's item (rename, move to project, delete).
          return <ThreadItem key={`thread:${row.id}`} thread={row.thread} isMobile={isMobile} />
        })}
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
