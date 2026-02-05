/**
 * Draggable Thread Component
 * Wrapper for threads that enables drag-and-drop functionality
 */

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DraggableThreadProps {
  threadId: string
  children: ReactNode
  className?: string
}

export function DraggableThread({
  threadId,
  children,
  className,
}: DraggableThreadProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: threadId,
      data: {
        type: 'thread',
        threadId,
      },
    })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'transition-opacity duration-200',
        isDragging && 'z-50 shadow-2xl scale-105',
        className
      )}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  )
}
