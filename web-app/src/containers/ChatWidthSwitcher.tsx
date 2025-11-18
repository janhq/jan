import { Skeleton } from '@/components/ui/skeleton'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { cn } from '@/lib/utils'
import { IconCircleCheckFilled } from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'

export function ChatWidthSwitcher() {
  const { chatWidth, setChatWidth } = useInterfaceSettings()
  const { t } = useTranslation()

  return (
    <div className="flex flex-col sm:flex-row sm:gap-4">
      <button
        className={cn(
          'w-full overflow-hidden border border-main-view-fg/10 rounded-md my-2 pb-2 cursor-pointer',
          chatWidth === 'compact' && 'border-accent'
        )}
        onClick={() => setChatWidth('compact')}
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2 bg-main-view-fg/10 -mt-1">
          <span className="font-medium text-xs font-sans">
            {t('common:compactWidth')}
          </span>
          {chatWidth === 'compact' && (
            <IconCircleCheckFilled className="size-4 text-accent" />
          )}
        </div>
        <div className="overflow-auto p-2">
          <div className="flex flex-col px-6 gap-2 mt-2">
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-2 w-full rounded-full" />
            <div className="bg-main-view-fg/10 h-8 px-4 w-full flex-shrink-0 border-none resize-none outline-0 rounded-sm flex items-center truncate">
              <span className="text-main-view-fg/50 line-clamp-1">
                {t('common:placeholder.chatInput')}
              </span>
            </div>
          </div>
        </div>
      </button>
      <button
        className={cn(
          'w-full overflow-hidden border border-main-view-fg/10 rounded-md my-2 pb-2 cursor-pointer',
          chatWidth === 'full' && 'border-accent'
        )}
        onClick={() => setChatWidth('full')}
      >
        <div className="flex items-center justify-between px-4 py-2 bg-main-view-fg/10">
          <span className="font-medium text-xs font-sans">
            {t('common:fullWidth')}
          </span>
          {chatWidth === 'full' && (
            <IconCircleCheckFilled className="size-4 text-accent" />
          )}
        </div>
        <div className="overflow-auto p-2">
          <div className="flex flex-col gap-2 mt-2">
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-2 w-full rounded-full" />
            <div className="bg-main-view-fg/10 h-8 px-4 w-full flex-shrink-0 border-none resize-none outline-0 rounded-sm flex items-center">
              <span className="text-main-view-fg/50">
                {t('common:placeholder.chatInput')}
              </span>
            </div>
          </div>
        </div>
      </button>
    </div>
  )
}
