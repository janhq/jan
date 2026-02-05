import { cn } from '@/lib/utils'
import { ReactNode } from 'react'

type CardProps = {
  title?: string
  children?: ReactNode
  header?: ReactNode
  className?: string
}

type CardItemProps = {
  title?: string | ReactNode
  description?: string | ReactNode
  descriptionOutside?: string | ReactNode
  align?: 'start' | 'center' | 'end'
  actions?: ReactNode
  column?: boolean
  className?: string
  classNameWrapperAction?: string
}

export function CardItem({
  title,
  description,
  descriptionOutside,
  className,
  classNameWrapperAction,
  align = 'center',
  column,
  actions,
}: CardItemProps) {
  const alignmentClasses = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
  }

  return (
    <div className="flex flex-col group">
      <div
        className={cn(
          'flex justify-between mt-2 first:mt-0 border-b border-main-view-fg/5 pb-3 last:border-none last:pb-0 gap-8',
          descriptionOutside && 'border-0 pb-1', // Reduce padding if description is below
          !column && alignmentClasses[align],
          column && 'flex-col gap-y-2 items-start',
          className
        )}
      >
        <div className="space-y-1 flex-1">
          {title && (
            <div className="font-medium text-main-view-fg">{title}</div>
          )}
          {description && (
            <div className="text-sm text-main-view-fg/70 leading-normal">
              {description}
            </div>
          )}
        </div>

        {actions && (
          <div
            className={cn(
              'shrink-0',
              classNameWrapperAction,
              column && 'w-full'
            )}
          >
            {actions}
          </div>
        )}
      </div>

      {descriptionOutside && (
        <div className="text-sm text-main-view-fg/70 leading-normal pb-3 border-b border-main-view-fg/5 last:border-none last:pb-0">
          {descriptionOutside}
        </div>
      )}
    </div>
  )
}

export function Card({ title, children, header, className }: CardProps) {
  return (
    <div
      className={cn(
        'bg-main-view-fg/3 p-4 rounded-lg text-main-view-fg/90 w-full',
        className
      )}
    >
      {title && (
        <h2 className="text-main-view-fg font-semibold text-base mb-4">
          {title}
        </h2>
      )}
      {header && <div className="mb-4">{header}</div>}
      <div className="flex flex-col">{children}</div>
    </div>
  )
}
