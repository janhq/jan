import { ChevronDown, FolderOpen, SquareArrowOutUpRight } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { resolveInRoot } from '@/lib/codePreview'
import { ARTIFACT_ICON, type CodeArtifact } from '@/lib/codeArtifacts'

/**
 * Inline card for something the agent produced (jan-internal #242).
 *
 * Rendered by the Cowork transcript itself rather than by `MessageItem`, which
 * is shared with the chat surface — the association is derived from a message's
 * own write/edit parts, so nothing shared needs to know artifacts exist.
 *
 * Card body opens the in-app preview; the split button hands the file to the OS.
 */
export function CodeArtifactCard({
  artifact,
  root,
  onPreview,
}: {
  artifact: CodeArtifact
  root: string | null
  onPreview: (path: string) => void
}) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const Icon = ARTIFACT_ICON[artifact.group]
  const abs = root ? resolveInRoot(root, artifact.path) : null

  return (
    <div className="my-3 flex items-center gap-4 rounded-xl border bg-main-view px-4 py-4 shadow-sm transition-colors hover:border-main-view-fg/25">
      <button
        type="button"
        onClick={() => onPreview(artifact.path)}
        title={t('common:artifactOpenPreview')}
        className="flex min-w-0 flex-1 items-center gap-4 text-left"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border bg-main-view-fg/[0.03]">
          <Icon size={20} className="text-main-view-fg/50" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold">{artifact.title}</span>
          <span className="mt-0.5 block truncate text-xs text-main-view-fg/55">
            {artifact.group} · {artifact.label}
          </span>
        </span>
      </button>

      {abs && (
        <div className="flex shrink-0 items-center rounded-md border">
          <button
            type="button"
            onClick={() => void serviceHub.opener().openPath(abs)}
            className="flex items-center gap-1.5 rounded-l-md px-3 py-2 text-[13px] font-medium hover:bg-main-view-fg/5"
          >
            <SquareArrowOutUpRight size={14} className="text-main-view-fg/60" />
            {t('common:artifactOpenExternal')}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('common:artifactMoreActions')}
                className="rounded-r-md border-l px-2 py-2 hover:bg-main-view-fg/5"
              >
                <ChevronDown size={14} className="text-main-view-fg/60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void serviceHub.opener().openPath(abs)}>
                <SquareArrowOutUpRight size={14} />
                {t('common:artifactOpenExternal')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void serviceHub.opener().revealItemInDir(abs)}>
                <FolderOpen size={14} />
                {t('common:artifactShowInFolder')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}
