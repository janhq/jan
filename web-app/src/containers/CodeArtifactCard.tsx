import { ChevronDown, FolderOpen, SquareArrowOutUpRight } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Card } from '@/components/ui/card'
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
    <Card className="my-3 flex items-center gap-3 p-3">
      <button
        type="button"
        onClick={() => onPreview(artifact.path)}
        title={t('common:artifactOpenPreview')}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md border">
          <Icon size={18} className="text-muted-foreground" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{artifact.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {artifact.group} · {artifact.label}
          </span>
        </span>
      </button>

      {abs && (
        <div className="flex shrink-0 items-center rounded-md border">
          <button
            type="button"
            onClick={() => void serviceHub.opener().openPath(abs)}
            className="flex items-center gap-1.5 rounded-l-md px-2.5 py-1.5 text-xs hover:bg-accent"
          >
            <SquareArrowOutUpRight size={13} className="text-muted-foreground" />
            {t('common:artifactOpenExternal')}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('common:artifactMoreActions')}
                className="rounded-r-md border-l px-1.5 py-1.5 hover:bg-accent"
              >
                <ChevronDown size={13} className="text-muted-foreground" />
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
    </Card>
  )
}
