import { useState, type ComponentType } from 'react'
import { ChevronDown, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { CoworkSidePanel } from '@/containers/CoworkSidePanel'
import {
  ARTIFACT_GROUP_NAMES,
  ARTIFACT_ICON,
  type CoworkArtifact,
} from '@/lib/coworkArtifacts'
import type { CoworkAttachedFile } from '@/types/coworkSession'

type Row = {
  key: string
  name: string
  label: string
  /** What the preview pane opens; absent when there is no copy to open. */
  previewPath?: string
  detail?: string
}

type Group = {
  id: string
  title: string
  Icon: ComponentType<{ size?: number; className?: string }>
  rows: Row[]
}

/**
 * Every file the session touched, in two families: what the user attached and
 * what the agent produced, the latter in the artifact library's groups. Each
 * group folds independently; a row opens the preview rail in place.
 */
export function CoworkFilesPanel({
  attachments,
  artifacts,
  onPreview,
  onClose,
}: {
  attachments: CoworkAttachedFile[]
  artifacts: CoworkArtifact[]
  onPreview: (path: string) => void
  onClose: () => void
}): React.ReactElement {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const groups: Group[] = []
  if (attachments.length > 0) {
    groups.push({
      id: 'attachments',
      title: t('common:files.attachments'),
      Icon: Paperclip,
      rows: attachments.map((f) => ({
        key: `att:${f.path}`,
        name: f.name,
        label: (f.fileType ?? '').toUpperCase(),
        previewPath: f.workspacePath,
        detail: f.workspacePath ? undefined : t('common:files.notImported'),
      })),
    })
  }
  for (const group of ARTIFACT_GROUP_NAMES) {
    const rows = artifacts.filter((a) => a.group === group)
    if (rows.length === 0) continue
    groups.push({
      id: group,
      title: t(`common:artifactGroup${group}`),
      Icon: ARTIFACT_ICON[group],
      rows: rows.map((a) => ({
        key: `art:${a.path}`,
        name: `${a.title}.${a.label.toLowerCase()}`,
        label: a.label,
        previewPath: a.path,
      })),
    })
  }
  const total = groups.reduce((sum, g) => sum + g.rows.length, 0)

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <CoworkSidePanel
      title={t('common:files.title')}
      summary={
        <span className="shrink-0 text-xs font-mono text-main-view-fg/60">
          {total}
        </span>
      }
      onClose={onClose}
    >
      <div className="h-full overflow-y-auto">
        {groups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-main-view-fg/50">
            {t('common:files.empty')}
          </p>
        ) : (
          <div className="divide-y">
            {groups.map((group) => {
              const open = !collapsed.has(group.id)
              return (
                <div key={group.id}>
                  <button
                    type="button"
                    onClick={() => toggle(group.id)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
                  >
                    <ChevronDown
                      size={14}
                      className={cn(
                        'shrink-0 text-main-view-fg/50 transition-transform',
                        !open && '-rotate-90'
                      )}
                    />
                    <group.Icon size={14} className="shrink-0 text-main-view-fg/60" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {group.title}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-main-view-fg/50">
                      {group.rows.length}
                    </span>
                  </button>
                  {open && (
                    <ul className="pb-1">
                      {group.rows.map((row) => (
                        <li key={row.key}>
                          <button
                            type="button"
                            disabled={!row.previewPath}
                            onClick={() =>
                              row.previewPath && onPreview(row.previewPath)
                            }
                            title={row.previewPath}
                            className={cn(
                              'flex w-full items-center gap-2 py-1.5 pl-9 pr-3 text-left text-xs',
                              row.previewPath
                                ? 'hover:bg-muted/50'
                                : 'cursor-default text-main-view-fg/50'
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {row.name}
                            </span>
                            {row.detail ? (
                              <span className="shrink-0 italic">{row.detail}</span>
                            ) : (
                              <span className="shrink-0 font-mono text-main-view-fg/50">
                                {row.label}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </CoworkSidePanel>
  )
}
