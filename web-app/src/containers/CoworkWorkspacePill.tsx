import { Folder, GitBranch, HardDrive, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import { basenameOf } from '@/lib/codePreview'
import { truncateMiddle } from '@/lib/utils'

type Props = {
  /** Attached project folder, or null when the session is sandbox-only. */
  folder: string | null
  /** Absolute path of this session's sandbox — where every write lands. */
  sandboxPath: string | null
  gitBranch?: string | null
  onAttach: () => void
  onDetach: () => void
}

/**
 * Names both halves of the session's filesystem: the read-only folder it reads
 * from, and the sandbox it writes to.
 *
 * The two headings carry the whole point. A single "folder" control would imply
 * the agent edits your project, which it cannot — so the direction is stated
 * structurally rather than in a warning the user learns to skip.
 */
export function CoworkWorkspacePill({
  folder,
  sandboxPath,
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
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 rounded-full shrink-0"
          aria-label={
            folderName
              ? t('common:workspace.a11yWithFolder', { folder: folderName })
              : t('common:workspace.a11ySandboxOnly')
          }
        >
          {folderName ? (
            <>
              <Folder size={14} className="text-muted-foreground shrink-0" />
              <span className="truncate max-w-[120px]">{folderName}</span>
              <span className="text-muted-foreground/80 text-xs">
                {t('common:workspace.readOnly')}
              </span>
              <span aria-hidden className="text-muted-foreground/60">
                →
              </span>
            </>
          ) : null}
          <HardDrive size={14} className="text-muted-foreground shrink-0" />
          <span>{t('common:workspace.sandbox')}</span>
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
                onClick={() =>
                  void serviceHub.opener().revealItemInDir(folder)
                }
              >
                {t('common:workspace.reveal')}
              </Button>
            </div>
            <Separator className="my-3" />
          </>
        ) : null}

        <p className="text-xs font-medium text-muted-foreground">
          {t('common:workspace.writesTo')}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <HardDrive size={14} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">
            {t('common:workspace.sandboxForSession')}
          </span>
          {sandboxPath && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 shrink-0"
              onClick={() => void serviceHub.opener().openPath(sandboxPath)}
            >
              {t('common:workspace.open')}
            </Button>
          )}
        </div>
        {sandboxPath && (
          <p
            className="mt-0.5 font-mono text-xs text-muted-foreground"
            title={sandboxPath}
          >
            {truncateMiddle(sandboxPath, 44)}
          </p>
        )}

        <Separator className="my-3" />

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
