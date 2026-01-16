import { memo, useEffect, useState } from 'react'
import { useAppState } from '@/hooks/useAppState'
import { useMessages } from '@/hooks/useMessages'
import { useThreads } from '@/hooks/useThreads'
import { useModelProvider } from '@/hooks/useModelProvider'
import { sendCompletion } from '@/lib/completion'
import { ContentType } from '@janhq/core'

interface MermaidErrorComponentProps {
  error: string
  chart: string
  retry: () => void
  messageId?: string
}

/**
 * Animated running cat component
 * Displays a cute cat running animation when mermaid diagram errors
 * Automatically attempts to fix the diagram when streaming finishes
 */
function MermaidErrorComponent({
  error,
  chart,
  retry,
  messageId,
}: MermaidErrorComponentProps) {
  const [isFixing, setIsFixing] = useState(false)
  const [hasAttemptedFix, setHasAttemptedFix] = useState(false)

  const streamingContent = useAppState((state) => state.streamingContent)
  const isStreaming =
    streamingContent !== undefined && streamingContent !== null
  const getCurrentThread = useThreads((state) => state.getCurrentThread)
  const getMessages = useMessages((state) => state.getMessages)
  const updateMessage = useMessages((state) => state.updateMessage)
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const getProviderByName = useModelProvider((state) => state.getProviderByName)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)

  useEffect(() => {
    // Only attempt to fix once when streaming finishes
    if (!isStreaming && !hasAttemptedFix && !isFixing && chart) {
      fixMermaidDiagram()
    }
  }, [isStreaming, hasAttemptedFix, isFixing, chart])

  const fixMermaidDiagram = async () => {
    const thread = getCurrentThread()
    if (!thread || !selectedModel || !selectedProvider) {
      return
    }

    const provider = getProviderByName(selectedProvider)
    if (!provider) {
      return
    }

    setIsFixing(true)
    setHasAttemptedFix(true)

    try {
      // Get the last assistant message from the current thread
      const messages = getMessages(thread.id)
      const toEditMessage = messages.find((m) => m.id === messageId)

      if (!toEditMessage) {
        return
      }
      const currentContent = toEditMessage.content?.[0]?.text?.value || ''

      // Create a prompt to fix the mermaid diagram
      const fixPrompt = `The following mermaid diagram has an error:

\`\`\`mermaid
${chart}
\`\`\`

Error: ${error}

Please fix the mermaid diagram syntax. Here is the format of linechart
xychart
    title "Sales Revenue"
    x-axis [jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec]
    y-axis "Revenue (in $)" 4000 --> 11000
    bar [5000, 6000, 7500, 8200, 9500, 10500, 11000, 10200, 9200, 8500, 7000, 6000]
    line [5000, 6000, 7500, 8200, 9500, 10500, 11000, 10200, 9200, 8500, 7000, 6000]

Make sure no brackets in the chart title or x-axis or y-axis, string should be wrapped in double quotes, no text right to the close bracket. Remember line and bar are arrays and items should be wrapped in square brackets.
Don't put any extra fields or syntax that is not part of mermaid syntax such as series or markers.

If it's not xychart, just provide the corrected mermaid diagram, simplify to avoid syntax error, remove special characters that can cause error like bracket or quote.
Example for TDChart:

graph TD
    A[Enter Chart Definition] --> B(Preview)
    B --> C{decide}
    C --> D[Keep]
    C --> E[Edit Definition]
    E --> B
    D --> F[Save Image and Code]
    F --> B
There is no space and only 1 word after [], no bracket () or {} within []. No styles or links.
REMEMBER: There should be no text right to the close bracket ].

Return ONLY the corrected mermaid code block in the following format:
\`\`\`mermaid
[corrected diagram code here]
\`\`\`



Do not include explanations or additional text.`

      // Call the model to fix the diagram
      const abortController = new AbortController()

      const completion = await sendCompletion(
        thread,
        provider,
        [
          {
            role: 'user',
            content: fixPrompt,
          },
        ],
        abortController,
        [],
        false
      )
      // Extract the fixed mermaid code
      if (
        completion &&
        'choices' in completion &&
        completion.choices?.[0]?.message?.content
      ) {
        const fixedContent = completion.choices[0].message.content as string

        // Extract mermaid code from markdown code block
        const mermaidMatch = fixedContent.match(/```mermaid\s*([\s\S]*?)\s*```/)
        const fixedMermaid = mermaidMatch
          ? mermaidMatch[1].trim()
          : fixedContent.trim()

        // Replace only the exact broken mermaid diagram, not all mermaid blocks
        const escapedChart = chart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const exactPattern = new RegExp(
          '```mermaid\\s*' + escapedChart + '\\s*```'
        )
        const updatedContent = currentContent.replace(
          exactPattern,
          `\`\`\`mermaid\n${fixedMermaid}\n\`\`\``
        )
        // Update the message with the fixed mermaid
        updateMessage({
          ...toEditMessage,
          content: [
            {
              type: ContentType.Text,
              text: {
                value: updatedContent,
                annotations: [],
              },
            },
          ],
        })

        // Retry rendering the diagram after a brief delay
        setTimeout(() => {
          retry()
        }, 100)
      }
    } catch (err) {
      console.error('Failed to fix mermaid diagram:', err)
    } finally {
      setIsFixing(false)
    }
  }
  return (
    <div className="flex flex-col items-center justify-center p-6 gap-3">
      <img src="/images/jan-logo.png" alt="Jan Logo" className="h-12 w-12" />
      <p className="text-sm text-muted-foreground text-center">
        {isFixing
          ? 'Fixing the diagram...'
          : isStreaming
            ? 'Error detected, fixing soon...'
            : 'Diagram error detected'}
      </p>
      {!isStreaming && hasAttemptedFix && !isFixing && (
        <p className="text-xs text-muted-foreground/60 text-center mt-1">
          Auto-fix attempted. Check the updated diagram.
        </p>
      )}
    </div>
  )
}

export const MermaidError = memo(MermaidErrorComponent)
