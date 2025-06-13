/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
import ReactMarkdown, { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkEmoji from 'remark-emoji'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { codeToHtml, type BundledLanguage, type BundledTheme } from 'shiki'
import { memo, useState, useMemo, useEffect, useRef } from 'react'
import { getReadableLanguageName } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { useCodeblock } from '@/hooks/useCodeblock'
import { useTheme } from '@/hooks/useTheme'
import 'katex/dist/katex.min.css'
import { IconCopy, IconCopyCheck } from '@tabler/icons-react'
import rehypeRaw from 'rehype-raw'

interface MarkdownProps {
  content: string
  className?: string
  components?: Components
  enableRawHtml?: boolean
  isUser?: boolean
  isWrapping?: boolean
}

// Map codeBlockStyle to Shiki themes - using only valid bundled themes
const getShikiTheme = (style: string, isDark: boolean): BundledTheme => {
  // Valid Shiki bundled themes - only including themes that are actually bundled
  const validThemes: Record<string, BundledTheme> = {
    'github-dark': 'github-dark',
    'github-light': 'github-light',
    'dark-plus': 'dark-plus',
    'light-plus': 'light-plus',
    'one-dark-pro': 'one-dark-pro',
    'material-theme': 'material-theme',
    'material-theme-darker': 'material-theme-darker',
    'material-theme-lighter': 'material-theme-lighter',
    'material-theme-ocean': 'material-theme-ocean',
    'material-theme-palenight': 'material-theme-palenight',
    'night-owl': 'night-owl',
    'tokyo-night': 'tokyo-night',
    'slack-dark': 'slack-dark',
    'slack-ochin': 'slack-ochin',
    'solarized-dark': 'solarized-dark',
    'solarized-light': 'solarized-light',
    'vitesse-dark': 'vitesse-dark',
    'vitesse-light': 'vitesse-light',
    'catppuccin-mocha': 'catppuccin-mocha',
    'catppuccin-macchiato': 'catppuccin-macchiato',
    'catppuccin-latte': 'catppuccin-latte',
    'ayu-dark': 'ayu-dark',
    'min-light': 'min-light',
    'min-dark': 'min-dark',
    'synthwave-84': 'synthwave-84',
    'rose-pine': 'rose-pine',
    'rose-pine-moon': 'rose-pine-moon',
    'rose-pine-dawn': 'rose-pine-dawn',
    'monokai': 'monokai',
    'dracula': 'dracula',
    'nord': 'nord',
    'houston': 'houston',
  }

  // If the theme is valid, use it directly
  if (validThemes[style]) {
    return validThemes[style]
  }

  // Fallback for unknown themes based on dark/light preference
  return isDark ? 'github-dark' : 'github-light'
}

// Simple hash function for strings
const hashString = (str: string): string => {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36)
}

// Highlight code with Shiki
const highlightCode = async (
  code: string,
  language: string,
  theme: string,
  showLineNumbers: boolean,
  isDark: boolean
): Promise<string> => {
  try {
    const shikiTheme = getShikiTheme(theme, isDark)
    const html = await codeToHtml(code, {
      lang: (language || 'text') as BundledLanguage,
      theme: shikiTheme,
      transformers: showLineNumbers ? [
        {
          name: 'line-numbers',
          line(node, line) {
            node.children.unshift({
              type: 'element',
              tagName: 'span',
              properties: {
                className: ['line-number'],
                style: 'color: #666; margin-right: 1em; user-select: none;'
              },
              children: [{ type: 'text', value: String(line).padStart(2, ' ') + ' ' }]
            })
          }
        }
      ] : []
    })

    return html
  } catch (error) {
    console.error('Shiki highlighting error:', error)
    // Fallback to plain text
    return `<pre><code>${code}</code></pre>`
  }
}

// Separate component for code highlighting to properly use React hooks
interface CodeBlockProps {
  code: string
  language: string
  codeId: string
  theme: string
  showLineNumbers: boolean
  onCopy: (code: string, id: string) => void
  copiedId: string | null
  isWrapping?: boolean
}

const CodeBlock = memo(({
  code,
  language,
  codeId,
  theme,
  showLineNumbers,
  onCopy,
  copiedId,
  isWrapping
}: CodeBlockProps) => {
  const { isDark } = useTheme()
  const [highlightedHtml, setHighlightedHtml] = useState<string>('')
  const [isHighlighting, setIsHighlighting] = useState(true)
  const isMountedRef = useRef(false)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (code && language) {
      setIsHighlighting(true)
      
      // Check if we should use virtualization for large code blocks
      const shouldVirtualize = code.split('\n').length > 300
      
      if (shouldVirtualize) {
        // For very large code blocks, use a simpler highlighting approach
        // to avoid performance issues
        setHighlightedHtml(`<pre><code class="language-${language}">${code}</code></pre>`)
        setIsHighlighting(false)
      } else {
        highlightCode(code, language, theme, showLineNumbers, isDark).then(html => {
          if (isMountedRef.current) {
            setHighlightedHtml(html)
            setIsHighlighting(false)
          }
        }).catch(() => {
          if (isMountedRef.current) {
            setIsHighlighting(false)
          }
        })
      }
    }
  }, [code, language, theme, showLineNumbers, isDark])

  return (
    <div className="relative overflow-hidden border rounded-md border-main-view-fg/2">
      <div className="flex items-center justify-between px-4 py-2 bg-main-view/10">
        <span className="font-medium text-xs font-sans">
          {getReadableLanguageName(language)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onCopy(code, codeId)
          }}
          className="flex items-center gap-1 text-xs font-sans transition-colors cursor-pointer"
        >
          {copiedId === codeId ? (
            <>
              <IconCopyCheck size={16} className="text-primary" />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <IconCopy size={16} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div
        className={cn(
          "shiki-container [&_.shiki]:!bg-transparent [&_.shiki]:!m-0 [&_.shiki]:!p-0",
          isWrapping && "[&_pre]:whitespace-pre-wrap [&_code]:whitespace-pre-wrap [&_pre]:break-all [&_code]:break-all"
        )}
        style={{
          margin: 0,
          padding: '8px',
          borderRadius: '0 0 4px 4px',
          overflow: 'auto',
          border: 'none',
          maxHeight: '400px',
        }}
      >
        {isHighlighting ? (
          <pre><code>{code}</code></pre>
        ) : highlightedHtml ? (
          <div dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        ) : (
          <pre><code>{code}</code></pre>
        )}
      </div>
    </div>
  )
})

CodeBlock.displayName = 'CodeBlock'

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

  // Function to handle copying code to clipboard
  const handleCopy = (code: string, id: string) => {
    navigator.clipboard.writeText(code)
    setCopiedId(id)

    // Reset copied state after 2 seconds
    setTimeout(() => {
      setCopiedId(null)
    }, 2000)
  }

  // Default components for syntax highlighting and emoji rendering
  const defaultComponents: Components = useMemo(
    () => ({
      code: ({ className, children }) => {
        const match = /language-(\w+)/.exec(className || '')
        const language = match ? match[1] : ''
        const isInline = !match || !language

        const code = String(children).replace(/\n$/, '')

        // Generate a stable ID based on code content and language
        const codeId = `code-${hashString(code.substring(0, 40) + language)}`

        return !isInline && !isUser ? (
          <CodeBlock
            code={code}
            language={language}
            codeId={codeId}
            theme={codeBlockStyle}
            showLineNumbers={showLineNumbers}
            onCopy={handleCopy}
            copiedId={copiedId}
            isWrapping={isWrapping}
          />
        ) : (
          <code className={cn(className)}>{children}</code>
        )
      },
    }),
    [codeBlockStyle, showLineNumbers, copiedId, handleCopy, isUser, isWrapping]
  )

  // Memoize the remarkPlugins to prevent unnecessary re-renders
  const remarkPlugins = useMemo(() => {
    // Using a simpler configuration to avoid TypeScript errors
    return [remarkGfm, remarkMath, remarkEmoji]
  }, [])

  // Memoize the rehypePlugins to prevent unnecessary re-renders
  const rehypePlugins = useMemo(() => {
    return enableRawHtml ? [rehypeKatex, rehypeRaw] : [rehypeKatex]
  }, [enableRawHtml])

  // Merge custom components with default components
  const mergedComponents = useMemo(
    () => ({
      ...defaultComponents,
      ...components,
    }),
    [defaultComponents, components]
  )

  // Render the markdown content
  return (
    <div
      className={cn(
        'markdown break-words select-text',
        isUser && 'is-user',
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={mergedComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

// Use a simple memo without custom comparison to allow re-renders when content changes
// This is important for streaming content to render incrementally
export const RenderMarkdown = memo(RenderMarkdownComponent)
