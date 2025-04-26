import ReactMarkdown from 'react-markdown'
import { cn } from '@/lib/utils'

interface MarkdownProps {
  content: string
  className?: string
}

export function RenderMarkdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn('markdown', className)}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}
