/**
 * Droppable Project Component
 * Drop zone for threads to be moved into projects
 */

import { useDroppable } from '@dnd-kit/core'
import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DroppableProjectProps {
  projectId: string
  children: ReactNode
  className?: string
}

export function DroppableProject({
  projectId,
  children,
  className,
}: DroppableProjectProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: projectId,
    data: {
      type: 'project',
      projectId,
    },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'transition-all duration-200',
        isOver && 'ring-2 ring-accent bg-accent/5',
        className
      )}
    >
      {children}
      {isOver && (
        <div className="absolute inset-0 pointer-events-none border-2 border-dashed border-accent rounded-lg bg-accent/10 flex items-center justify-center">
          <span className="text-accent font-medium">Drop thread here</span>
        </div>
      )}
    </div>
  )
}
