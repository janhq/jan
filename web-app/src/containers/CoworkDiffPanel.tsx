import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { DiffView } from '@/components/DiffView'
import { CoworkSidePanel } from '@/containers/CoworkSidePanel'
import type { CoworkFileDiff } from '@/lib/coworkDiffs'

/**
 * Every write and edit this session landed, grouped by file.
 *
 * No folder or branch header: an attached folder is mounted read-only, so
 * nothing here is ever a change to the user's project. Naming their repo and
 * branch beside "Agent changes" claimed the opposite.
 */
export function CoworkDiffPanel({
  files,
  onClose,
}: {
  files: CoworkFileDiff[]
  onClose: () => void
}): React.ReactElement {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)

  const toggleFile = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  return (
    <CoworkSidePanel
      title={t('common:changes.title')}
      summary={
        <span className="shrink-0 text-xs font-mono text-main-view-fg/60">
          +{additions} -{deletions}
        </span>
      }
      onClose={onClose}
    >
      <div className="h-full overflow-y-auto">
        {files.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-main-view-fg/50">
            {t('common:changes.empty')}
          </p>
        ) : (
          <div className="divide-y">
            {files.map((file) => {
              const isExpanded = expanded.has(file.path)
              return (
                <div key={file.path}>
                  <button
                    type="button"
                    onClick={() => toggleFile(file.path)}
                    aria-expanded={isExpanded}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
                  >
                    <ChevronDown
                      size={14}
                      className={cn(
                        'shrink-0 text-main-view-fg/50 transition-transform',
                        !isExpanded && '-rotate-90'
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {file.path}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-green-600">
                      +{file.additions}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-red-600">
                      -{file.deletions}
                    </span>
                  </button>
                  {isExpanded ? (
                    <div className="border-t bg-background">
                      {file.operations.map((operation, index) => (
                        <div
                          key={`${file.path}-${index}`}
                          className="border-b last:border-b-0"
                        >
                          {operation.source === 'subagent' &&
                          operation.sourceName ? (
                            <p className="px-3 pt-2 text-xs text-muted-foreground">
                              {operation.sourceName}
                            </p>
                          ) : null}
                          <DiffView
                            diff={operation.diff}
                            className="max-h-none rounded-none border-0"
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </CoworkSidePanel>
  )
}
