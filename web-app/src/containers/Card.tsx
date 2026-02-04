import { cn } from '@/lib/utils'
import { ReactNode } from 'react'

type CardProps = {
  title?: string
  children?: ReactNode
  header?: ReactNode
<<<<<<< HEAD
  className?: string
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
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

=======
  return (
    <>
      <div
        className={cn(
          'flex justify-between mt-2 first:mt-0 border-b border-border/40 pb-3 last:border-none last:pb-0 gap-8',
          descriptionOutside && 'border-0',
          align === 'start' && 'items-start',
          align === 'center' && 'items-center',
          align === 'end' && 'items-end',
          column && 'flex-col gap-y-0 items-start',
          className
        )}
      >
        <div className="space-y-1.5">
          <h1 className="font-medium text-foreground">{title}</h1>
          {description && (
            <span className="text-muted-foreground leading-normal">
              {description}
            </span>
          )}
        </div>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD

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
=======
      {descriptionOutside && (
        <span className="text-muted-foreground leading-normal">
          {descriptionOutside}
        </span>
      )}
    </>
  )
}

export function Card({ title, children, header }: CardProps) {
  return (
    <div className="bg-card p-4 rounded-lg text-muted-foreground w-full">
      {title && (
        <h1 className="text-foreground font-studio font-medium text-base mb-4">
          {title}
        </h1>
      )}
      {header && header}
      {children}
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    </div>
  )
}
