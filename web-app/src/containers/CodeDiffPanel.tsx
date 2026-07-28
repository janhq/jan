import { useState } from 'react'
import { ChevronDown, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DiffView } from '@/components/DiffView'
import { CodeSidePanel } from '@/containers/CodeSidePanel'
import type { CodeFileDiff } from '@/lib/codeDiffs'

export function CodeDiffPanel({
  files,
  folderName,
  gitBranch,
  onClose,
}: {
  files: CodeFileDiff[]
  folderName?: string
  gitBranch: string | null
  onClose: () => void
}): React.ReactElement {
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
    <CodeSidePanel
      title="Agent changes"
      summary={
        <span className="shrink-0 text-xs font-mono text-main-view-fg/60">
          +{additions} -{deletions}
        </span>
      }
      onClose={onClose}
    >
      <div className="h-full overflow-y-auto">
        <div className="flex flex-col gap-2 border-b p-3 text-xs text-main-view-fg/60">
          <div className="truncate" title={folderName}>
            {folderName ?? 'No folder selected'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {gitBranch ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 font-mono">
                <GitBranch size={10} />
                {gitBranch}
              </span>
            ) : null}
            <span>{files.length} files</span>
            <span className="font-mono text-green-600">+{additions}</span>
            <span className="font-mono text-red-600">-{deletions}</span>
          </div>
        </div>

        {files.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-main-view-fg/50">
            Successful agent write and edit changes will appear here.
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
                        <div key={`${file.path}-${index}`} className="border-b last:border-b-0">
                          {operation.source === 'subagent' && operation.sourceName ? (
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
    </CodeSidePanel>
  )
}
