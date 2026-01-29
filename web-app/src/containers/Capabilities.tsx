import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  IconEye,
  IconTool,
  IconAtom,
  IconWorld,
  IconCodeCircle2,
} from '@tabler/icons-react'
import { Fragment } from 'react/jsx-runtime'

interface CapabilitiesProps {
  capabilities: string[]
}

const Capabilities = ({ capabilities }: CapabilitiesProps) => {
  if (!capabilities.length) return null

  // Filter out proactive capability as it's now managed in MCP settings
  const filteredCapabilities = capabilities.filter((capability) => {
    return capability !== 'proactive'
  })

  return (
    <div className="flex gap-0.5">
      {filteredCapabilities.map((capability: string, capIndex: number) => {
        let icon = null

        // Embedding models get special treatment with a distinct visual style
        const isEmbedding = capability === 'embeddings'

        if (capability === 'vision') {
          icon = <IconEye className="size-4" />
        } else if (capability === 'tools') {
          icon = <IconTool className="size-3.5" />
        } else if (capability === 'reasoning') {
          icon = <IconAtom className="size-3.5" />
        } else if (capability === 'embeddings') {
          icon = <IconCodeCircle2 className="size-3.5" />
        } else if (capability === 'web_search') {
          icon = <IconWorld className="size-3.5" />
        } else {
          icon = null
        }

        // Special badge style for embedding models
        const badgeClass = isEmbedding
          ? 'flex items-center gap-1 px-1.5 h-5 bg-amber-500/10 border border-amber-500/20 rounded text-amber-600 dark:text-amber-400 justify-center last:mr-1 hover:bg-amber-500/20 transition-all text-[10px] font-medium'
          : 'flex items-center gap-1 size-5 bg-main-view-fg/5 rounded text-main-view-fg/50 justify-center last:mr-1 hover:text-main-view-fg transition-all'

        return (
          <Fragment key={`capability-${capIndex}`}>
            {icon && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="flex items-center gap-1 size-5 hover:bg-secondary rounded text-muted-foreground justify-center last:mr-1 transition-all"
                      title={capability}
                    >
                      {icon}
                      {isEmbedding && <span>Embedding</span>}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {capability === 'web_search'
                        ? 'Web Search'
                        : capability === 'embeddings'
                          ? 'Embedding Model (for RAG/vectors, not chat)'
                          : capability}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

export default Capabilities
