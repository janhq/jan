
import { Components } from 'react-markdown'
import { memo, useEffect, useMemo, useRef } from 'react'
import { cn, disableIndentedCodeBlockPlugin } from '@/lib/utils'
import { ttftEnabled, ttftMark, ttftReport } from '@/lib/ttft-timing'
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
  isAnimating
}: MarkdownProps) {

  const normalizedContent = useMemo(() => normalizeLatex(content), [content])
  const thetaMarked = useRef(false)

  useEffect(() => {
    thetaMarked.current = false
  }, [messageId])

  useEffect(() => {
    if (content.length > 0 && !thetaMarked.current && ttftEnabled()) {
      thetaMarked.current = true
      ttftMark('thetaFirstRender')
      ttftReport('first-visible-render')
    }
  }, [content, messageId])

  if (content.length > 0 && content.length < 32) {
    return (
      <div
        dir="auto"
        className={cn(
          'markdown wrap-break-word select-text whitespace-pre-wrap',
          isUser && 'is-user',
          className
        )}
      >
        {content}
      </div>
    )
  }

  return (
    <div
      dir="auto"
      className={cn(
        'markdown wrap-break-word select-text',
        isUser && 'is-user',
        className
      )}
    >
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
    </div>
  )
}
export const RenderMarkdown = memo(
  RenderMarkdownComponent,
  (prevProps, nextProps) => prevProps.content === nextProps.content
)
