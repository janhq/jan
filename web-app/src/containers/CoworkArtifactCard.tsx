import { useState } from 'react'
import { ChevronDown, Ellipsis, Eye, FolderOpen, SquareArrowOutUpRight } from 'lucide-react'
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
import {
  openOrReveal,
  previewKindFor,
  resolveInRoots,
} from '@/lib/coworkPreview'
import { ARTIFACT_ICON, type CoworkArtifact } from '@/lib/coworkArtifacts'
import { artifactOpener } from '@/lib/previewProtocol'
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
 * Card body opens the in-app preview; secondary actions hand the file to the OS.
 */
export function CoworkArtifactCard({
  artifact,
  roots,
  onPreview,
  showPath = false,
  variant = 'inline',
  className,
}: {
  artifact: CoworkArtifact
  /** Every place a session may have written the file: its sandbox and, when
   * attached, the writable project folder. Resolved in order. */
  roots: Array<string | null>
  onPreview: (path: string) => void
  /** The library sets this: many sessions' files need the disambiguating path. */
  showPath?: boolean
  /** Transcript cards stay compact; library cards reserve room for the file. */
  variant?: 'inline' | 'library'
  className?: string
}) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const isLibrary = variant === 'library'
  const [failedThumb, setFailedThumb] = useState<string | null>(null)
  const Icon = ARTIFACT_ICON[artifact.group]
  const abs = resolveInRoots(roots, artifact.path)?.abs ?? null
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
        'group/artifact flex transition-colors',
        isLibrary
          ? 'min-h-20 flex-row items-center gap-4 rounded-xl border border-border bg-background p-4 shadow-none hover:bg-muted dark:border-border/60 dark:hover:bg-muted/30'
          : 'h-[50px] items-center justify-between gap-2.5 rounded-xl border border-border bg-muted px-2.5 py-2 shadow-none dark:border-transparent dark:bg-muted/40',
        className
      )}
    >
      <button
        type="button"
        onClick={() => onPreview(artifact.path)}
        title={t('common:artifactOpenPreview')}
        aria-label={isLibrary ? `${t('common:artifactOpenPreview')}: ${artifact.title}` : undefined}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          isLibrary ? 'items-center gap-3' : 'items-center gap-2.5'
        )}
      >
        {thumb && failedThumb !== thumb ? (
          <img
            src={thumb}
            alt=""
            onError={() => setFailedThumb(thumb)}
            className={isLibrary
              ? 'size-12 shrink-0 rounded-lg bg-muted/30 object-cover'
              : 'size-8 shrink-0 rounded-lg object-cover'}
          />
        ) : (
          <span
            className={cn(
              'flex shrink-0 items-center justify-center',
              isLibrary ? 'size-12 rounded-lg' : 'size-8 rounded-lg',
              GROUP_TINT[artifact.group]
            )}
          >
            <Icon className={isLibrary ? "size-6!" : "size-[18px]!"} size={isLibrary ? 24 : 18} strokeWidth={isLibrary ? 1.4 : 2} aria-hidden="true" />
          </span>
        )}
        {/* min-w-0 on a block box: `truncate` is inert otherwise. */}
        <span className={cn("min-w-0 flex-1", isLibrary && "py-0.5")}>
          <span
            className={cn("block text-sm font-medium", isLibrary ? "line-clamp-2 break-words leading-5" : "truncate")}
            title={artifact.title}
          >
            {artifact.title}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
            <span className={cn("text-[10px] font-medium tracking-wide", isLibrary && "text-xs")}>
              {artifact.label}
            </span>
            <span className="truncate">
              {t(`common:artifactGroup${artifact.group}`)}
            </span>
          </span>
          {(showPath || isLibrary) && (
            <span title={artifact.path} className="mt-1 block truncate text-xs text-muted-foreground/70">
              {artifact.path}
            </span>
          )}
        </span>
        {/* Hover affordance: the whole body is a preview button, but nothing
            said so before the pointer found the tooltip. */}
        {!isLibrary && <Eye
          size={14}
          className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/artifact:opacity-100"
        />}
      </button>

      {abs && (
        <div className={cn(
          "flex shrink-0 items-center",
          isLibrary ? "justify-end gap-1" : "overflow-hidden rounded-full border border-border/60 bg-background"
        )}>
          <button
            type="button"
            onClick={() => void openOrReveal(artifactOpener(), roots, abs)}
            title={t('common:artifactOpenExternal')}
            aria-label={t('common:artifactOpenExternal')}
            className={cn(
              'flex items-center justify-center text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isLibrary ? 'size-8 rounded-md' : 'gap-1.5 px-2.5 py-1.5'
            )}
          >
            <SquareArrowOutUpRight size={13} className="text-muted-foreground" />
            {!isLibrary && <span className="hidden sm:inline">
              {t('common:artifactOpenExternal')}
            </span>}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('common:artifactMoreActions')}
                title={t('common:artifactMoreActions')}
                className={cn(
                  'flex items-center justify-center hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isLibrary ? 'size-8 rounded-md' : 'px-1.5 py-1.5'
                )}
              >
                {isLibrary ? <Ellipsis size={16} className="text-muted-foreground" /> : <ChevronDown size={13} className="text-muted-foreground" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onPreview(artifact.path)}>
                <Eye size={14} />
                {t('common:artifactOpenPreview')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => void openOrReveal(artifactOpener(), roots, abs)}
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
