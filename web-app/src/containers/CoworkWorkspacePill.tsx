import { Eye, Folder, FolderPlus, GitBranch, PencilLine } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import { basenameOf } from '@/lib/coworkPreview'
import { truncateMiddle } from '@/lib/utils'

type Props = {
  /** Attached project folder, or null when the session is sandbox-only. */
  folder: string | null
  gitBranch?: string | null
  /** What the agent may do in the folder. Old Cowork folders were always
   * read and write, so that stays the default; a unified thread can grant read
   * only, and the pill must not claim more than the grant. */
  access?: 'read' | 'write' | null
  /** Disable mutations and folder actions while a strict grant save is pending. */
  saving?: boolean
  /** When set, the popover offers an "Allow changes" switch for the folder. */
  onAccessChange?: (access: 'read' | 'write') => void
  /** Offered only while the folder has no host grant (access is null). */
  onAllowAccess?: () => void
  onAttach: () => void
  onDetach: () => void
}

/**
 * Attach, inspect and detach the shared project folder.
 *
 * The sandbox is deliberately unnamed: it is an implementation detail the user
 * never picks or opens, and surfacing it invited the reading that the folder
 * and the sandbox are two halves of one choice. What has to stay visible is the
 * access contract on the folder — the agent reads AND edits it in place.
 *
 * The trigger is icon-only until a folder is attached, matching the composer
 * row's other controls: with nothing attached there is no name to print, and a
 * pill reading "Attach a folder" outweighed every icon beside it.
 */
export function CoworkWorkspacePill({
  folder,
  gitBranch,
  access = 'write',
  saving = false,
  onAccessChange,
  onAllowAccess,
  onAttach,
  onDetach,
}: Props) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const folderName = folder ? basenameOf(folder) : null

  const notifyWorkspaceActionError = (
    action: 'open' | 'reveal',
    error: unknown
  ) => {
    const detail = error instanceof Error ? error.message : String(error)
    const missing = /ENOENT|no such file|does not exist|not found|path not found/i.test(detail)
    const title = missing
      ? t('common:workspace.unavailable')
      : t(
          action === 'open'
            ? 'common:workspace.openFailed'
            : 'common:workspace.revealFailed'
        )

    toast.error(title, {
      description: missing
        ? t('common:workspace.missing', { folder: folderName })
        : detail,
      action: {
        label: t('common:workspace.change'),
        onClick: onAttach,
      },
    })
  }

  const handleOpen = async () => {
    if (!folder) return
    try {
      await serviceHub.opener().openPath(folder)
    } catch (error) {
      notifyWorkspaceActionError('open', error)
    }
  }

  const handleReveal = async () => {
    if (!folder) return
    try {
      await serviceHub.opener().revealItemInDir(folder)
    } catch (error) {
      notifyWorkspaceActionError('reveal', error)
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={folderName ? 'outline' : 'ghost'}
          size={folderName ? 'sm' : 'icon-xs'}
          className={folderName
            ? 'h-9 max-w-64 shrink-0 gap-2 rounded-full border-border bg-background px-4 text-muted-foreground shadow-none hover:bg-muted has-[>svg]:px-4'
            : 'shrink-0 text-muted-foreground'}
          aria-label={
            folderName
              ? access === null
                ? folderName
                : t(access === 'write' ? 'common:workspace.a11yWithFolder' : 'common:workspace.a11yWithFolderReadOnly', { folder: folderName })
              : t('common:workspace.a11yNoFolder')
          }
        >
          {folderName ? (
            <>
              <Folder className="size-4 shrink-0" />
              <span className="max-w-[160px] truncate">
                {folderName}
              </span>
            </>
          ) : (
            <FolderPlus className="size-[18px] shrink-0" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-3">
        {folder ? (
          <>
            {access !== null && <p className="text-xs font-medium text-muted-foreground">
              {t('common:workspace.readsFrom')}
            </p>}
            <div className="mt-1 flex items-center gap-2">
              <Folder size={14} className="shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{folderName}</span>
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                {access === null ? null : access === 'write' ? <PencilLine size={10} /> : <Eye size={10} />}
                {access === null ? '—' : t(access === 'write' ? 'common:workspace.writable' : 'common:workspace.readOnly')}
              </span>
            </div>
            <p
              className="mt-0.5 font-mono text-xs text-muted-foreground"
              title={folder}
            >
              {truncateMiddle(folder, 44)}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              {gitBranch && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                  <GitBranch size={10} />
                  {gitBranch}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7"
                disabled={saving}
                onClick={handleOpen}
              >
                {t('common:workspace.open')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                disabled={saving}
                onClick={handleReveal}
              >
                {t('common:workspace.reveal')}
              </Button>
            </div>
            <Separator className="my-3" />
          </>
        ) : null}

        {folder && access === null && onAllowAccess && (
          <div className="mb-2 flex items-center gap-2 text-sm">
            <span className="flex-1 text-xs text-muted-foreground">
              {t('common:conversationScope.folderNeedsConfirmation')}
            </span>
            <Button variant="outline" size="sm" className="h-7" disabled={saving} onClick={onAllowAccess}>
              {t('common:conversationScope.confirmFolder')}
            </Button>
          </div>
        )}

        {folder && onAccessChange && (
          <label className="mb-2 flex items-center gap-2 text-sm">
            <span className="flex-1">{t('common:workspace.allowChanges')}</span>
            <Switch
              disabled={saving}
              checked={access === 'write'}
              onCheckedChange={(on) => onAccessChange(on ? 'write' : 'read')}
            />
          </label>
        )}

        {access !== null && <p className="text-xs text-muted-foreground">
          {folder
            ? t(access === 'write' ? 'common:workspace.footnote' : 'common:workspace.footnoteReadOnly')
            : t('common:workspace.footnoteEmpty')}
        </p>}

        <div className="mt-3 flex items-center gap-2">
          {folder ? (
            <>
              <Button variant="ghost" size="sm" disabled={saving} onClick={onDetach}>
                {t('common:workspace.detach')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                disabled={saving}
                onClick={onAttach}
              >
                {t('common:workspace.change')}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              disabled={saving}
              onClick={onAttach}
            >
              {t('common:workspace.attach')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
