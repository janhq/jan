/**
 *  Project Card Component
 * Features: Icon picker, color picker, statistics, quick actions
 */

import { useState } from 'react'
import { ThreadFolder } from '@/services/projects/types'
import { cn } from '@/lib/utils'
import {
  IconDots,
  IconEdit,
  IconTrash,
  IconDownload,
  IconMessagePlus,
  IconPin,
  IconPinFilled,
} from '@tabler/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

interface ProjectCardProps {
  project: ThreadFolder
  threadCount?: number
  messageCount?: number
  modelCount?: number
  isOpen?: boolean
  onOpen?: (projectId: string) => void
  onEdit?: (projectId: string) => void
  onDelete?: (projectId: string) => void
  onExport?: (projectId: string) => void
  onNewThread?: (projectId: string) => void
  onToggleStar?: (projectId: string) => void
}

const PROJECT_COLORS = [
  {
    name: 'Blue',
    value: 'bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/20',
  },
  {
    name: 'Purple',
    value: 'bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20',
  },
  {
    name: 'Green',
    value: 'bg-green-500/10 border-green-500/30 hover:bg-green-500/20',
  },
  {
    name: 'Yellow',
    value: 'bg-yellow-500/10 border-yellow-500/30 hover:bg-yellow-500/20',
  },
  { name: 'Red', value: 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20' },
  {
    name: 'Pink',
    value: 'bg-pink-500/10 border-pink-500/30 hover:bg-pink-500/20',
  },
  {
    name: 'Orange',
    value: 'bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/20',
  },
  {
    name: 'Gray',
    value: 'bg-main-view-fg/10 border-main-view-fg/30 hover:bg-main-view-fg/20',
  },
]

export function ProjectCard({
  project,
  threadCount = 0,
  messageCount = 0,
  modelCount = 0,
  isOpen = false,
  onOpen,
  onEdit,
  onDelete,
  onExport,
  onNewThread,
  onToggleStar,
}: ProjectCardProps) {
  const [isHovered, setIsHovered] = useState(false)

  const colorClass = project.color
    ? PROJECT_COLORS.find(
        (c) => c.name.toLowerCase() === project.color?.toLowerCase()
      )?.value
    : 'bg-main-view-fg/5 border-main-view-fg/10 hover:bg-main-view-fg/10'

  const priorityColor = {
    high: 'text-red-500',
    medium: 'text-yellow-500',
    low: 'text-green-500',
  }[project.metadata?.priority || 'medium']

  return (
    <div
      className={cn(
        'group relative p-4 rounded-lg border transition-all duration-200 cursor-pointer',
        colorClass,
        isOpen && 'ring-2 ring-accent'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onOpen?.(project.id)}
    >
      {/* Star indicator */}
      {project.metadata?.starred && (
        <div className="absolute top-2 right-2">
          <IconPinFilled size={16} className="text-accent" />
        </div>
      )}

      {/* Header with icon and title */}
      <div className="flex items-start gap-3 mb-3">
        <div className="text-2xl flex-shrink-0">
          {project.icon || (isOpen ? '📂' : '📁')}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-main-view-fg truncate">
            {project.name}
          </h3>
          {project.description && (
            <p className="text-xs text-main-view-fg/60 line-clamp-2 mt-1">
              {project.description}
            </p>
          )}
        </div>
      </div>

      {/* Statistics */}
      <div className="flex items-center gap-4 text-xs text-main-view-fg/60 mb-3">
        <div className="flex items-center gap-1">
          <span className="font-medium text-main-view-fg">{threadCount}</span>
          <span>threads</span>
        </div>
        {messageCount > 0 && (
          <>
            <span className="text-main-view-fg/30">•</span>
            <div className="flex items-center gap-1">
              <span className="font-medium text-main-view-fg">
                {messageCount}
              </span>
              <span>messages</span>
            </div>
          </>
        )}
        {modelCount > 0 && (
          <>
            <span className="text-main-view-fg/30">•</span>
            <div className="flex items-center gap-1">
              <span className="font-medium text-main-view-fg">
                {modelCount}
              </span>
              <span>models</span>
            </div>
          </>
        )}
      </div>

      {/* Tags */}
      {project.metadata?.tags && project.metadata.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {project.metadata.tags.slice(0, 3).map((tag, idx) => (
            <span
              key={idx}
              className="px-2 py-0.5 text-xs rounded-full bg-accent/10 text-accent border border-accent/20"
            >
              {tag}
            </span>
          ))}
          {project.metadata.tags.length > 3 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-main-view-fg/5 text-main-view-fg/60">
              +{project.metadata.tags.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Priority indicator */}
      {project.metadata?.priority && project.metadata.priority !== 'medium' && (
        <div className={cn('text-xs font-medium mb-2', priorityColor)}>
          {project.metadata.priority.toUpperCase()} PRIORITY
        </div>
      )}

      {/* Quick actions - visible on hover */}
      <div
        className={cn(
          'flex items-center gap-2 transition-opacity duration-200',
          isHovered ? 'opacity-100' : 'opacity-0'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => onNewThread?.(project.id)}
        >
          <IconMessagePlus size={14} className="mr-1" />
          New Thread
        </Button>

        <div className="flex-1" />

        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          onClick={() => onToggleStar?.(project.id)}
        >
          {project.metadata?.starred ? (
            <IconPinFilled size={14} className="text-accent" />
          ) : (
            <IconPin size={14} />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="size-7 p-0">
              <IconDots size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit?.(project.id)}>
              <IconEdit size={16} />
              <span>Edit Project</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport?.(project.id)}>
              <IconDownload size={16} />
              <span>Export Project</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete?.(project.id)}
              className="text-destructive focus:text-destructive"
            >
              <IconTrash size={16} />
              <span>Delete Project</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Archived badge */}
      {project.metadata?.archived && (
        <div className="absolute bottom-2 right-2">
          <span className="px-2 py-0.5 text-xs rounded bg-main-view-fg/10 text-main-view-fg/50">
            Archived
          </span>
        </div>
      )}
    </div>
  )
}
