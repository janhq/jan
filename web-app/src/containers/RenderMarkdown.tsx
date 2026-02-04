<<<<<<< HEAD
import ReactMarkdown, { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkEmoji from 'remark-emoji'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import rehypeKatex from 'rehype-katex'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import * as prismStyles from 'react-syntax-highlighter/dist/cjs/styles/prism'
import { memo, useState, useMemo, useCallback } from 'react'
import { getReadableLanguageName } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { useCodeblock } from '@/hooks/useCodeblock'
import 'katex/dist/katex.min.css'
import { IconCopy, IconCopyCheck } from '@tabler/icons-react'
import rehypeRaw from 'rehype-raw'
import { useTranslation } from '@/i18n/react-i18next-compat'
=======
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Components } from 'react-markdown'
import { memo, useMemo } from 'react'
import { cn, disableIndentedCodeBlockPlugin } from '@/lib/utils'
// import 'katex/dist/katex.min.css'
import { defaultRehypePlugins, Streamdown } from 'streamdown'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'

import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { MermaidError } from '@/components/MermaidError'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

interface MarkdownProps {
  content: string
  className?: string
  components?: Components
<<<<<<< HEAD
  enableRawHtml?: boolean
  isUser?: boolean
  isWrapping?: boolean
=======
  isUser?: boolean
  isStreaming?: boolean
  messageId?: string
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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

  const segments = input.split(/(```[\s\S]*?```|`[^`]*`|<[^>]+>)/g)

  const result = segments
    .map((segment) => {
      if (!segment) return ''

      // Skip code blocks, inline code, html tags
      if (/^```[\s\S]*```$/.test(segment)) return segment
      if (/^`[^`]*`$/.test(segment)) return segment
      if (/^<[^>]+>$/.test(segment)) return segment

      let s = segment

      // --- Display math: \[...\] surrounded by newlines
      s = s.replace(
        /(^|\n)\\\[\s*\n([\s\S]*?)\n\s*\\\](?=\n|$)/g,
        (_, pre, inner) => `${pre}$$\n${inner.trim()}\n$$`
      )

      // --- Inline math: space \( ... \)
      s = s.replace(
        /(^|[^$\\])\\\((.+?)\\\)(?=[^$\\]|$)/g,
        (_, pre, inner) => `${pre}$${inner.trim()}$`
      )

      // --- Escape $<number> to prevent Markdown from treating it as LaTeX
      // Example: "$1" → "\$1"
      s = s.replace(/\$(\d+)/g, (_, num) => '\\$' + num)

      return s
    })
    .join('')

  // Cache the result (with size limit to prevent memory leaks)
  if (latexCache.size > 100) {
    const firstKey = latexCache.keys().next().value || ''
    latexCache.delete(firstKey)
  }
  latexCache.set(input, result)

  return result
}

<<<<<<< HEAD
// Memoized code component to prevent unnecessary re-renders
const CodeComponent = memo(
  ({
    className,
    children,
    isUser,
    codeBlockStyle,
    showLineNumbers,
    isWrapping,
    onCopy,
    copiedId,
    ...props
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }: any) => {
    const { t } = useTranslation()
    const match = /language-(\w+)/.exec(className || '')
    const language = match ? match[1] : ''
    const isInline = !match || !language

    const code = String(children).replace(/\n$/, '')

    // Generate a stable ID based on content hash instead of position
    const codeId = useMemo(() => {
      let hash = 0
      for (let i = 0; i < code.length; i++) {
        const char = code.charCodeAt(i)
        hash = (hash << 5) - hash + char
        hash = hash & hash // Convert to 32-bit integer
      }
      return `code-${Math.abs(hash)}-${language}`
    }, [code, language])

    const handleCopyClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()
        onCopy(code, codeId)
      },
      [code, codeId, onCopy]
    )

    if (isInline || isUser) {
      return <code className={cn(className)}>{children}</code>
    }

    return (
      <div className="relative overflow-hidden border rounded-md border-main-view-fg/2">
        <style>
          {`
        .react-syntax-highlighter-line-number {
          user-select: none;
          -webkit-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
        }
      `}
        </style>
        <div className="flex items-center justify-between px-4 py-2 bg-main-view/10">
          <span className="font-medium text-xs font-sans">
            {getReadableLanguageName(language)}
          </span>
          <button
            onClick={handleCopyClick}
            className="flex items-center gap-1 text-xs font-sans transition-colors cursor-pointer"
          >
            {copiedId === codeId ? (
              <>
                <IconCopyCheck size={16} className="text-primary" />
                <span>{t('copied')}</span>
              </>
            ) : (
              <>
                <IconCopy size={16} />
                <span>{t('copy')}</span>
              </>
            )}
          </button>
        </div>
        <SyntaxHighlighter
          style={
            prismStyles[
              codeBlockStyle
                .split('-')
                .map((part: string, index: number) =>
                  index === 0
                    ? part
                    : part.charAt(0).toUpperCase() + part.slice(1)
                )
                .join('') as keyof typeof prismStyles
            ] || prismStyles.oneLight
          }
          language={language}
          showLineNumbers={showLineNumbers}
          wrapLines={true}
          lineProps={
            isWrapping
              ? {
                  style: { wordBreak: 'break-all', whiteSpace: 'pre-wrap' },
                }
              : {}
          }
          customStyle={{
            margin: 0,
            padding: '8px',
            borderRadius: '0 0 4px 4px',
            overflow: 'auto',
            border: 'none',
          }}
          PreTag="div"
          CodeTag={'code'}
          {...props}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    )
  }
)

CodeComponent.displayName = 'CodeComponent'

function RenderMarkdownComponent({
  content,
  enableRawHtml,
  className,
  isUser,
  components,
  isWrapping,
}: MarkdownProps) {
  const { codeBlockStyle, showLineNumbers } = useCodeblock()

  // State for tracking which code block has been copied
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Memoized copy handler
  const handleCopy = useCallback((code: string, id: string) => {
    navigator.clipboard.writeText(code)
    setCopiedId(id)

    // Reset copied state after 2 seconds
    setTimeout(() => {
      setCopiedId(null)
    }, 2000)
  }, [])
=======
function RenderMarkdownComponent({
  content,
  className,
  isUser,
  components,
  messageId,
}: MarkdownProps) {
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

  // Memoize the normalized content to avoid reprocessing on every render
  const normalizedContent = useMemo(() => normalizeLatex(content), [content])

<<<<<<< HEAD
  // Stable remarkPlugins reference
  const remarkPlugins = useMemo(() => {
    return [remarkGfm, remarkMath, remarkEmoji, remarkBreaks]
  }, [])

  // Stable rehypePlugins reference
  const rehypePlugins = useMemo(() => {
    return enableRawHtml ? [rehypeKatex, rehypeRaw] : [rehypeKatex]
  }, [enableRawHtml])

  // Memoized components with stable references
  const markdownComponents: Components = useMemo(
    () => ({
      code: (props) => (
        <CodeComponent
          {...props}
          isUser={isUser}
          codeBlockStyle={codeBlockStyle}
          showLineNumbers={showLineNumbers}
          isWrapping={isWrapping}
          onCopy={handleCopy}
          copiedId={copiedId}
        />
      ),
      // Add other optimized components if needed
      ...components,
    }),
    [
      isUser,
      codeBlockStyle,
      showLineNumbers,
      isWrapping,
      handleCopy,
      copiedId,
      components,
    ]
  )

=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  // Render the markdown content
  return (
    <div
      className={cn(
        'markdown break-words select-text',
        isUser && 'is-user',
        className
      )}
    >
<<<<<<< HEAD
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {normalizedContent}
      </ReactMarkdown>
=======
      <Streamdown
        animate={true}
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
          math: math,
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
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    </div>
  )
}
export const RenderMarkdown = memo(
  RenderMarkdownComponent,
  (prevProps, nextProps) => prevProps.content === nextProps.content
)
