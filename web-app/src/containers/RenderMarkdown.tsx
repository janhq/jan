
import { Components } from 'react-markdown'
import { memo, useMemo } from 'react'
import { cn, disableIndentedCodeBlockPlugin } from '@/lib/utils'
import { ParagraphAiEditLayer } from '@/components/ParagraphAiEditLayer'
// import 'katex/dist/katex.min.css'
import { defaultRehypePlugins, Streamdown } from 'streamdown'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { mermaid } from '@streamdown/mermaid'

import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { MermaidError } from '@/components/MermaidError'

interface MarkdownProps {
  content: string
  className?: string
  components?: Components
  isUser?: boolean
  isStreaming?: boolean
  messageId?: string
  isAnimating?: boolean
  /** When set, user can select text and use "Edit with AI" on assistant messages. */
  onApplyContentEdit?: (newMarkdown: string) => void
  /** Disable paragraph AI edit (e.g. while streaming). */
  paragraphEditDisabled?: boolean
}

// Cache for normalized LaTeX content
const latexCache = new Map<string, string>()

/**
 * Optimized preprocessor: normalize LaTeX fragments into $ / $$.
 * Uses caching to avoid reprocessing the same content.
 */
const normalizeLatex = (input: string): string => {
  // Check cache first
  if (latexCache.has(input)) {
    return latexCache.get(input)!
  }

  const segments = input.split(/(```[\s\S]*?```|`[^`]*`|<[a-zA-Z/_!][^>]*>)/g)

  let result = '';

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;

    // Captured code blocks, inline code, html tags
    if (i % 2 === 1) {
      result += segment;
      continue;
    }

    let s = segment;

    // --- Escape suspicious $<number> to prevent Markdown from treating it as LaTeX
    // Example: "$1" → "\$1"
    s = s.replace(/\$(\d+)(?![^\n]*\$([^\d]|$))/g, (_, num) => '\\$' + num)

    // --- Display math: \[...\] surrounded by newlines
    if (s.includes('\\['))
      s = s.replace(
        /(^|\n)\\\[\s*\n([\s\S]*?)\n\s*\\\](?=\n|$)/g,
        (_, pre, inner) => `${pre}$$\n${inner.trim()}\n$$`
      )

    // --- Inline math: space \( ... \)
    if (s.includes('\\('))
      s = s.replace(
        /(^|[^$\\])\\\((.+?)\\\)(?=[^$\\]|$)/g,
        (_, pre, inner) => `${pre}$${inner.trim()}$`
      )

    result += s;
  }

  // Cache the result (with size limit to prevent memory leaks)
  if (latexCache.size > 100) {
    const firstKey = latexCache.keys().next().value || ''
    latexCache.delete(firstKey)
  }
  latexCache.set(input, result)

  return result
}

function RenderMarkdownComponent({
  content,
  className,
  isUser,
  components,
  messageId,
  isAnimating,
  onApplyContentEdit,
  paragraphEditDisabled,
}: MarkdownProps) {

  // Memoize the normalized content to avoid reprocessing on every render
  const normalizedContent = useMemo(() => normalizeLatex(content), [content])

  const streamdownEl = (
    <Streamdown
        animate={isAnimating ?? true}
        animationDuration={500}
        linkSafety={{
          enabled: false,
        }}
        className={cn(
          'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          className
        )}
        remarkPlugins={[remarkGfm, remarkMath, disableIndentedCodeBlockPlugin]}
        rehypePlugins={[
          rehypeKatex,
          defaultRehypePlugins.harden,
        ]}
        components={components}
        plugins={{
          code: code,
          mermaid: mermaid,
          cjk: cjk,
        }}
        controls={{
          mermaid: {
            fullscreen: false,
          },
        }}
        mermaid={
          messageId
            ? {
                errorComponent: (props) => (
                  <MermaidError messageId={messageId} {...props} />
                ),
              }
            : {}
        }
      >
        {normalizedContent}
      </Streamdown>
  )

  // Render the markdown content
  return (
    <div
      dir="auto"
      className={cn(
        'markdown wrap-break-word select-text',
        isUser && 'is-user',
        className
      )}
    >
      {onApplyContentEdit ? (
        <ParagraphAiEditLayer
          sourceMarkdown={normalizedContent}
          disabled={paragraphEditDisabled}
          onApply={onApplyContentEdit}
        >
          {streamdownEl}
        </ParagraphAiEditLayer>
      ) : (
        streamdownEl
      )}
    </div>
  )
}
export const RenderMarkdown = memo(
  RenderMarkdownComponent,
  (prevProps, nextProps) =>
    prevProps.content === nextProps.content &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.isAnimating === nextProps.isAnimating &&
    prevProps.messageId === nextProps.messageId &&
    prevProps.onApplyContentEdit === nextProps.onApplyContentEdit &&
    prevProps.paragraphEditDisabled === nextProps.paragraphEditDisabled
)
