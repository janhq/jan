
import { Components } from 'react-markdown'
import { memo, useMemo } from 'react'
import {
  cn,
  disableIndentedCodeBlockPlugin,
  splitHtmlArtifacts,
} from '@/lib/utils'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { HtmlArtifact } from '@/components/HtmlArtifact'
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
import { CitationLink } from '@/components/CitationLink'
import { MarkdownTable } from '@/components/MarkdownTable'

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
  isAnimating,
  isStreaming,
}: MarkdownProps) {
  const renderHtmlArtifacts = useInterfaceSettings(
    (s) => s.renderHtmlArtifacts
  )

  // normalizeLatex is O(n) over the full string and its cache misses every chunk;
  // skip it while streaming (LaTeX can't render mid-token) to avoid O(n²) cost.
  const normalizedContent = useMemo(
    () => (isStreaming ? content : normalizeLatex(content)),
    [content, isStreaming]
  )

  const mergedComponents = useMemo<Components>(() => {
    const Anchor = (
      props: React.AnchorHTMLAttributes<HTMLAnchorElement>
    ) => {
      const { href, children, className: aClass } = props
      if (typeof href === 'string' && href.startsWith('#cite-')) {
        return (
          <CitationLink href={href} className={aClass}>
            {children}
          </CitationLink>
        )
      }
      return <a {...props}>{children}</a>
    }
    return { a: Anchor, table: MarkdownTable, ...(components ?? {}) } as Components
  }, [components])

  // Interactive HTML artifacts: only when the user opted in and the stream is
  // complete (an incomplete fence must not be torn out mid-token). Splitting the
  // string keeps Streamdown's code/mermaid/inline handling intact for everything
  // else — overriding its `code` component would replace all of it.
  const segments = useMemo(() => {
    if (isStreaming || !renderHtmlArtifacts) return null
    const segs = splitHtmlArtifacts(normalizedContent)
    return segs.some((s) => s.type === 'html') ? segs : null
  }, [normalizedContent, isStreaming, renderHtmlArtifacts])

  return (
    <div
      dir="auto"
      className={cn(
        'markdown wrap-break-word select-text',
        isUser && 'is-user',
        className
      )}
    >
      {segments
        ? segments.map((seg, i) =>
            seg.type === 'html' ? (
              <HtmlArtifact key={i} code={seg.content} />
            ) : (
              <StreamdownView
                key={i}
                content={seg.content}
                isStreaming={isStreaming}
                isAnimating={isAnimating}
                messageId={messageId}
                className={className}
                components={mergedComponents}
              />
            )
          )
        : (
          <StreamdownView
            content={normalizedContent}
            isStreaming={isStreaming}
            isAnimating={isAnimating}
            messageId={messageId}
            className={className}
            components={mergedComponents}
          />
        )}
    </div>
  )
}

interface StreamdownViewProps {
  content: string
  components: Components
  className?: string
  isStreaming?: boolean
  isAnimating?: boolean
  messageId?: string
}

function StreamdownView({
  content,
  components,
  className,
  isStreaming,
  isAnimating,
  messageId,
}: StreamdownViewProps) {
  return (
    <Streamdown
      mode={isStreaming ? 'streaming' : 'static'}
      parseIncompleteMarkdown={isStreaming ?? false}
      animate={isStreaming ? false : (isAnimating ?? true)}
      animationDuration={500}
      linkSafety={{
        enabled: false,
      }}
      className={cn(
        'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className
      )}
      remarkPlugins={[remarkGfm, remarkMath, disableIndentedCodeBlockPlugin]}
      rehypePlugins={[rehypeKatex, defaultRehypePlugins.harden]}
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
      {content}
    </Streamdown>
  )
}
export const RenderMarkdown = memo(
  RenderMarkdownComponent,
  (prevProps, nextProps) =>
    prevProps.content === nextProps.content &&
    prevProps.isStreaming === nextProps.isStreaming
)
