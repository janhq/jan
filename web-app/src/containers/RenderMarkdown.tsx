import ReactMarkdown, { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkEmoji from 'remark-emoji'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import * as prismStyles from 'react-syntax-highlighter/dist/cjs/styles/prism'
import { useState } from 'react'
import virtualizedRenderer from 'react-syntax-highlighter-virtualized-renderer'

import { cn } from '@/lib/utils'
import { useCodeblock } from '@/hooks/useCodeblock'

interface MarkdownProps {
  content: string
  className?: string
  components?: Components
}

// Helper function to get a more readable language name
function getReadableLanguageName(language: string): string {
  const languageMap: Record<string, string> = {
    js: 'JavaScript',
    jsx: 'React JSX',
    ts: 'TypeScript',
    tsx: 'React TSX',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    json: 'JSON',
    md: 'Markdown',
    py: 'Python',
    rb: 'Ruby',
    java: 'Java',
    c: 'C',
    cpp: 'C++',
    cs: 'C#',
    go: 'Go',
    rust: 'Rust',
    php: 'PHP',
    swift: 'Swift',
    kotlin: 'Kotlin',
    sql: 'SQL',
    sh: 'Shell',
    bash: 'Bash',
    ps1: 'PowerShell',
    yaml: 'YAML',
    yml: 'YAML',
    xml: 'XML',
    // Add more languages as needed
  }

  return (
    languageMap[language] ||
    language.charAt(0).toUpperCase() + language.slice(1)
  )
}

export function RenderMarkdown({
  content,
  className,
  components,
}: MarkdownProps) {
  const { codeBlockStyle, showLineNumbers } = useCodeblock()
  // State for tracking which code block has been copied
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Function to handle copying code to clipboard
  const handleCopy = (code: string, id: string) => {
    navigator.clipboard.writeText(code)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Default components for syntax highlighting and emoji rendering
  const defaultComponents: Components = {
    code: ({ className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || '')
      const language = match ? match[1] : ''
      const isInline = !match || !language

      // Generate a unique ID for this code block
      const codeId = `code-${Math.random().toString(36).substr(2, 9)}`
      const code = String(children).replace(/\n$/, '')

      const shouldVirtualize = code.split('\n').length > 300

      return !isInline ? (
        <div className="relative overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-main-view-fg/10">
            <span className="font-medium text-xs font-sans">
              {getReadableLanguageName(language)}
            </span>
            <button
              onClick={() => handleCopy(code, codeId)}
              className="copy-button flex items-center gap-1 text-xs font-medium hover:text-slate-300 transition-colors"
            >
              {copiedId === codeId ? (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-green-400"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <SyntaxHighlighter
            // @ts-expect-error - Type issues with style prop in react-syntax-highlighter
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
            customStyle={{
              margin: 0,
              padding: '8px',
              borderRadius: '0 0 4px 4px',
              overflow: 'auto',
              border: 'none',
            }}
            renderer={shouldVirtualize ? virtualizedRenderer() : undefined}
            PreTag="div"
            CodeTag={'code'}
            {...props}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxHighlighter>
        </div>
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      )
    },
  }

  // Merge custom components with default components
  const mergedComponents = { ...defaultComponents, ...components }

  return (
    <div className={cn('markdown', className)}>
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          [remarkEmoji, { padSpaceAfter: true, emoticon: false }],
        ]}
        rehypePlugins={[]}
        components={mergedComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
