import ReactMarkdown, { Components } from 'react-markdown'
import { cn } from '@/lib/utils'

interface MarkdownProps {
  content: string
  className?: string
  components?: Components
}

export function RenderMarkdown({
  content,
  className,
  components,
}: MarkdownProps) {
  return (
    <div className={cn('markdown', className)}>
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  )
}
