import { cn } from '@/lib/utils'
import { Tag } from '@/services/tags'

interface TagBadgeProps {
  tag: Tag
  size?: 'sm' | 'md'
  onRemove?: () => void
  className?: string
}

export function TagBadge({
  tag,
  size = 'sm',
  onRemove,
  className,
}: TagBadgeProps) {
  const sizeClasses =
    size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium transition-all',
        sizeClasses,
        className
      )}
      style={{
        backgroundColor: `${tag.color}20`,
        color: tag.color,
        border: `1px solid ${tag.color}40`,
      }}
    >
      {tag.icon && <span>{tag.icon}</span>}
      <span>{tag.name}</span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="ml-0.5 hover:opacity-70 transition-opacity"
          aria-label="Remove tag"
        >
          ×
        </button>
      )}
    </span>
  )
}

interface TagBadgeListProps {
  tagNames: string[]
  allTags: Tag[]
  maxVisible?: number
  size?: 'sm' | 'md'
  className?: string
}

export function TagBadgeList({
  tagNames,
  allTags,
  maxVisible = 3,
  size = 'sm',
  className,
}: TagBadgeListProps) {
  const tags = tagNames
    .map((name) => allTags.find((t) => t.name === name))
    .filter((t): t is Tag => !!t)
  const visibleTags = tags.slice(0, maxVisible)
  const remainingCount = tags.length - maxVisible

  if (tags.length === 0) return null

  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)}>
      {visibleTags.map((tag) => (
        <TagBadge key={tag.id} tag={tag} size={size} />
      ))}
      {remainingCount > 0 && (
        <span className="text-xs text-main-view-fg/50 font-medium">
          +{remainingCount}
        </span>
      )}
    </div>
  )
}
