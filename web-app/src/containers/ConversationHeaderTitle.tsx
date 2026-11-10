import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

type Props = {
  title?: string
  project?: { id: string; name: string }
}

/** Header describes the conversation; model configuration lives in its composer. */
export function ConversationHeaderTitle({ title, project }: Props) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 text-sm">
      {project && (
        <>
          <Link to="/project/$projectId" params={{ projectId: project.id }} className={cn('min-w-0 truncate text-muted-foreground hover:text-foreground', title ? 'max-w-[40%]' : 'max-w-full')} title={project.name}>
            {project.name}
          </Link>
          {title && <span aria-hidden="true" className="text-muted-foreground/40">/</span>}
        </>
      )}
      {title && <span className="truncate font-medium" title={title}>{title}</span>}
    </div>
  )
}
