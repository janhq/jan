import { IconFolder } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

interface ProjectIconProps {
  icon?: string
  color?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const COLOR_CLASSES = {
  blue: 'bg-blue-500/10 text-blue-500',
  purple: 'bg-purple-500/10 text-purple-500',
  green: 'bg-green-500/10 text-green-500',
  yellow: 'bg-yellow-500/10 text-yellow-500',
  red: 'bg-red-500/10 text-red-500',
  pink: 'bg-pink-500/10 text-pink-500',
  orange: 'bg-orange-500/10 text-orange-500',
  gray: 'bg-main-view-fg/4 text-main-view-fg/50',
}

const SIZE_CLASSES = {
  sm: 'size-6 text-sm',
  md: 'size-8 text-base',
  lg: 'size-12 text-2xl',
}

export function ProjectIcon({
  icon,
  color = 'gray',
  size = 'md',
  className,
}: ProjectIconProps) {
  const colorClass =
    COLOR_CLASSES[color as keyof typeof COLOR_CLASSES] || COLOR_CLASSES.gray
  const sizeClass = SIZE_CLASSES[size]

  return (
    <div
      className={cn(
        'rounded-md flex items-center justify-center shrink-0',
        colorClass,
        sizeClass,
        className
      )}
    >
      {icon ? (
        <span>{icon}</span>
      ) : (
        <IconFolder
          size={size === 'sm' ? 14 : size === 'md' ? 16 : 20}
          className="opacity-70"
        />
      )}
    </div>
  )
}
