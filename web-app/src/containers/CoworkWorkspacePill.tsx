import { Folder, FolderPlus, GitBranch, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import { basenameOf } from '@/lib/coworkPreview'
import { truncateMiddle } from '@/lib/utils'

type Props = {
  /** Attached project folder, or null when the session is sandbox-only. */
  folder: string | null
  gitBranch?: string | null
  onAttach: () => void
  onDetach: () => void
}

/**
 * Attach, inspect and detach the read-only project folder.
 *
 * The sandbox it writes into is deliberately unnamed: it is an implementation
 * detail the user never picks or opens, and surfacing it invited the reading
 * that the folder and the sandbox are two halves of one choice. What has to
 * stay visible is the read-only contract on the folder.
 *
 * The trigger is icon-only until a folder is attached, matching the composer
 * row's other controls: with nothing attached there is no name to print, and a
 * pill reading "Attach a folder" outweighed every icon beside it.
 */
export function CoworkWorkspacePill({
  folder,
  gitBranch,
  onAttach,
  onDetach,
}: Props) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const folderName = folder ? basenameOf(folder) : null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={folderName ? 'xs' : 'icon-xs'}
          className="shrink-0 text-muted-foreground"
          aria-label={
            folderName
              ? t('common:workspace.a11yWithFolder', { folder: folderName })
              : t('common:workspace.a11yNoFolder')
          }
        >
          {folderName ? (
            <>
              <Folder className="size-3.5 shrink-0" />
              <span className="max-w-[120px] truncate text-foreground">
                {folderName}
              </span>
              <Lock className="size-3 shrink-0 text-muted-foreground/70" />
            </>
          ) : (
            <FolderPlus className="size-[18px] shrink-0" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-3">
        {folder ? (
          <>
            <p className="text-xs font-medium text-muted-foreground">
              {t('common:workspace.readsFrom')}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <Folder size={14} className="shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{folderName}</span>
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                <Lock size={10} />
                {t('common:workspace.readOnly')}
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
                onClick={() => void serviceHub.opener().openPath(folder)}
              >
                {t('common:workspace.open')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => void serviceHub.opener().revealItemInDir(folder)}
              >
                {t('common:workspace.reveal')}
              </Button>
            </div>
            <Separator className="my-3" />
          </>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {folder
            ? t('common:workspace.footnote')
            : t('common:workspace.footnoteEmpty')}
        </p>

        <div className="mt-3 flex items-center gap-2">
          {folder ? (
            <>
              <Button variant="ghost" size="sm" onClick={onDetach}>
                {t('common:workspace.detach')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
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
