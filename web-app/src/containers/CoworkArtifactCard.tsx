import { ChevronDown, Eye, FolderOpen, SquareArrowOutUpRight } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Card } from '@/components/ui/card'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { previewKindFor, resolveInRoot } from '@/lib/coworkPreview'
import { ARTIFACT_ICON, type CoworkArtifact } from '@/lib/coworkArtifacts'
import { cn } from '@/lib/utils'

/** One accent per artifact family, so a transcript full of cards scans by
 * colour before it scans by title. Alpha backgrounds keep both themes. */
const GROUP_TINT: Record<CoworkArtifact['group'], string> = {
  Code: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  Image: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  Document: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  Video: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  Audio: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
}

/**
 * Card for something the agent produced (jan-internal #242), shared by the
 * Cowork transcript and the artifacts library.
 *
 * Rendered by the Cowork transcript itself rather than by `MessageItem`, which
 * is shared with the chat surface — the association is derived from a message's
 * own write/edit parts, so nothing shared needs to know artifacts exist.
 *
 * Card body opens the in-app preview; the split button hands the file to the OS.
 */
export function CoworkArtifactCard({
  artifact,
  root,
  onPreview,
  showPath = false,
  className,
}: {
  artifact: CoworkArtifact
  root: string | null
  onPreview: (path: string) => void
  /** The library sets this: many sessions' files need the disambiguating path. */
  showPath?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const Icon = ARTIFACT_ICON[artifact.group]
  const abs = root ? resolveInRoot(root, artifact.path) : null
  const kind = previewKindFor(artifact.path)
  // A real thumbnail only where the browser renders the file on its own; HTML
  // would need executing the page.
  const thumb =
    abs && (kind === 'image' || kind === 'svg')
      ? serviceHub.core().convertFileSrc(abs)
      : null

  return (
    <Card
      className={cn(
        'group/artifact flex items-center gap-3 p-2.5 transition-all hover:border-accent hover:shadow-sm',
        className
      )}
    >
      <button
        type="button"
        onClick={() => onPreview(artifact.path)}
        title={t('common:artifactOpenPreview')}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className="size-11 shrink-0 rounded-lg border object-cover"
          />
        ) : (
          <span
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-lg',
              GROUP_TINT[artifact.group]
            )}
          >
            <Icon size={20} />
          </span>
        )}
        {/* min-w-0 on a block box: `truncate` is inert otherwise. */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {artifact.title}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded border px-1 text-[10px] font-semibold tracking-wide">
              {artifact.label}
            </span>
            <span className="truncate">
              {t(`common:artifactGroup${artifact.group}`)}
            </span>
          </span>
          {showPath && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground/70">
              {artifact.path}
            </span>
          )}
        </span>
        {/* Hover affordance: the whole body is a preview button, but nothing
            said so before the pointer found the tooltip. */}
        <Eye
          size={14}
          className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/artifact:opacity-100"
        />
      </button>

      {abs && (
        <div className="flex shrink-0 items-center overflow-hidden rounded-md border">
          <button
            type="button"
            onClick={() => void serviceHub.opener().openPath(abs)}
            title={t('common:artifactOpenExternal')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <SquareArrowOutUpRight size={13} className="text-muted-foreground" />
            <span className="hidden sm:inline">
              {t('common:artifactOpenExternal')}
            </span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('common:artifactMoreActions')}
                className="border-l px-1.5 py-1.5 hover:bg-accent"
              >
                <ChevronDown size={13} className="text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onPreview(artifact.path)}>
                <Eye size={14} />
                {t('common:artifactOpenPreview')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => void serviceHub.opener().openPath(abs)}
              >
                <SquareArrowOutUpRight size={14} />
                {t('common:artifactOpenExternal')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void serviceHub.opener().revealItemInDir(abs)}
              >
                <FolderOpen size={14} />
                {t('common:artifactShowInFolder')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </Card>
  )
}
