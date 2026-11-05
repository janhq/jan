import { Eye, Folder, FolderPlus, GitBranch, PencilLine } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import { basenameOf } from '@/lib/coworkPreview'
import { truncateMiddle } from '@/lib/utils'

type Props = {
  /** Attached project folder, or null when the session is sandbox-only. */
  folder: string | null
  gitBranch?: string | null
  /** What the host has acknowledged for the folder: `'read'`, `'write'`, or
   * `null` when it is inactive (no host grant, a denied/failed confirmation, or
   * a host read error), which shows the confirmation control instead of an
   * access claim. CoworkPage always passes this explicitly, mapping a missing
   * session value to `null`; the pill never infers write access for a session.
   * The `'write'` default only applies to a caller that omits the prop. The
   * pill must not claim more than the grant. */
  access?: 'read' | 'write' | null
  /** Disable mutations and folder actions while a strict grant save is pending. */
  saving?: boolean
  /** When set, the access badge toggles the folder between read-only and read & write. */
  onAccessChange?: (access: 'read' | 'write') => void
  /** Offered only while the folder has no host grant (access is null). */
  onAllowAccess?: () => void
  onAttach: () => void
  onDetach: () => void
}

const badgeClass =
  'inline-flex items-center gap-1 self-start rounded-full bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground outline-none'
const revealClass = (extra: string) =>
  `${extra} cursor-pointer rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50`

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

  const notifyRevealError = (error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error)
    const missing = /ENOENT|no such file|does not exist|not found|path not found/i.test(detail)

    toast.error(
      missing ? t('common:workspace.unavailable') : t('common:workspace.revealFailed'),
      {
        description: missing
          ? t('common:workspace.missing', { folder: folderName })
          : detail,
        action: {
          label: t('common:workspace.change'),
          onClick: onAttach,
        },
      }
    )
  }

  const handleReveal = async () => {
    if (!folder) return
    try {
      await serviceHub.opener().revealItemInDir(folder)
    } catch (error) {
      notifyRevealError(error)
    }
  }

  const accessLabel =
    access === 'write' ? t('common:workspace.writable') : t('common:workspace.readOnly')
  const nextAccessLabel =
    access === 'write' ? t('common:workspace.readOnly') : t('common:workspace.writable')

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
            <div className="flex items-start gap-2">
              <Folder size={14} className="mt-[3px] shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className={revealClass('block max-w-full truncate text-left text-sm font-medium hover:underline')}
                  aria-label={t('common:workspace.revealFolder', { folder: folderName })}
                  disabled={saving}
                  onClick={handleReveal}
                >
                  {folderName}
                </button>
                <button
                  type="button"
                  className={revealClass('mt-0.5 block max-w-full truncate text-left font-mono text-xs text-muted-foreground hover:text-foreground hover:underline')}
                  aria-label={t('common:workspace.revealFolder', { folder })}
                  title={folder}
                  disabled={saving}
                  onClick={handleReveal}
                >
                  {truncateMiddle(folder, 44)}
                </button>
              </div>
              {access === null ? (
                <span className={`${badgeClass} shrink-0`}>—</span>
              ) : (
                <button
                  type="button"
                  className={`${badgeClass} shrink-0 cursor-pointer transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50`}
                  aria-label={t('common:workspace.changeAccess', { current: accessLabel, next: nextAccessLabel })}
                  disabled={saving || !onAccessChange}
                  onClick={() => onAccessChange?.(access === 'write' ? 'read' : 'write')}
                >
                  {access === 'write' ? <PencilLine size={10} /> : <Eye size={10} />}
                  {accessLabel}
                </button>
              )}
            </div>

            {gitBranch && (
              <span className={`${badgeClass} mt-2`}>
                <GitBranch size={10} />
                {gitBranch}
              </span>
            )}

            {access === null && onAllowAccess && (
              <div className="mt-2 flex items-center gap-2">
                <span className="flex-1 text-xs text-muted-foreground">
                  {t('common:conversationScope.folderNeedsConfirmation')}
                </span>
                <Button variant="outline" size="sm" className="h-7" disabled={saving} onClick={onAllowAccess}>
                  {t('common:conversationScope.confirmFolder')}
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t('common:workspace.footnoteEmpty')}
          </p>
        )}

        <div className="mt-3 flex items-center gap-2">
          {folder ? (
            <>
              <Button variant="ghost" size="sm" className="h-7" disabled={saving} onClick={onDetach}>
                {t('common:workspace.detach')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7"
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
