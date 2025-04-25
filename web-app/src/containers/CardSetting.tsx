import { cn } from '@/lib/utils'
import { ReactNode } from 'react'

type CardSettingProps = {
  title?: string
  children?: ReactNode
}

type CardSettingItemProps = {
  title?: string
  description?: string | ReactNode
  align?: 'start' | 'center' | 'end'
  actions?: ReactNode
}

export function CardSettingItem({
  title,
  description,
  align = 'center',
  actions,
}: CardSettingItemProps) {
  return (
    <div
      className={cn(
        'flex justify-between mt-2 first:mt-0 border-b border-main-view-fg/5 pb-3 last:border-none last:pb-0 gap-8',
        align === 'start' && 'items-start',
        align === 'center' && 'items-center',
        align === 'end' && 'items-end'
      )}
    >
      <div className="space-y-1.5">
        <h1 className="font-medium">{title}</h1>
        {description && (
          <span className="text-main-view-fg/70 leading-normal">
            {description}
          </span>
        )}
      </div>
      <div className="shrink-0">{actions}</div>
    </div>
  )
}

export function CardSetting({ title, children }: CardSettingProps) {
  return (
    <div className="bg-main-view-fg/4 p-4 rounded-lg text-main-view-fg/90 w-full">
      {title && (
        <h1 className="text-main-view-fg font-medium text-base mb-4">
          {title}
        </h1>
      )}
      {children}
    </div>
  )
}
