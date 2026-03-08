import { memo } from 'react'

interface MermaidErrorComponentProps {
  error: string
  chart: string
  retry: () => void
  messageId?: string
}

/**
 * Mermaid diagram error component
 * Displays an error message when mermaid diagram fails to render
 */
function MermaidErrorComponent({
  error,
}: MermaidErrorComponentProps) {
  return (
    <div className="flex flex-col items-center justify-center p-6 gap-3">
      <img src="/images/jan-logo.png" alt="Jan Logo" className="h-12 w-12" />
      <p className="text-sm text-muted-foreground text-center">
        Diagram error detected
      </p>
      <p className="text-xs text-muted-foreground/60 text-center mt-1">
        {error}
      </p>
    </div>
  )
}

export const MermaidError = memo(MermaidErrorComponent)
