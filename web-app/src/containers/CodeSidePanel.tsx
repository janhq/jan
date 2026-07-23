import { useState, type ReactNode } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'

type CodeSidePanelProps = {
  title: ReactNode
  leading?: ReactNode
  summary?: ReactNode
  children: ReactNode
  onClose: () => void
}

export function CodeSidePanel({
  title,
  leading,
  summary,
  children,
  onClose,
}: CodeSidePanelProps): React.ReactElement {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-l bg-main-view',
        expanded ? 'w-[32rem] max-w-[60vw]' : 'w-80'
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        {leading}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        {summary}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? t('common:collapse') : t('common:expand')}
          title={expanded ? t('common:collapse') : t('common:expand')}
          className="text-main-view-fg/60 hover:text-main-view-fg"
        >
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common:close')}
          className="text-main-view-fg/60 hover:text-main-view-fg"
        >
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </aside>
  )
}
