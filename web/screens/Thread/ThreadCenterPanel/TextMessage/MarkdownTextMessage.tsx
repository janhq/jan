/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/naming-convention */
import React, { memo } from 'react'

import Markdown from 'react-markdown'

import rehypeHighlight from 'rehype-highlight'
import rehypeHighlightCodeLines from 'rehype-highlight-code-lines'

import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'

import remarkMath from 'remark-math'

import 'katex/dist/katex.min.css'
import 'highlight.js/styles/atom-one-dark.css'
import '@/styles/components/marked.scss'

import { twMerge } from 'tailwind-merge'

import { useClipboard } from '@/hooks/useClipboard'

import { getLanguageFromExtension } from '@/utils/codeLanguageExtension'

import { markdownComponents } from './MarkdownUtils'

interface Props {
  text: string
  isUser?: boolean
  className?: string
  renderKatex?: boolean
}

export const MarkdownTextMessage = memo(
  ({ text, isUser, className, renderKatex = true }: Props) => {
    const clipboard = useClipboard({ timeout: 1000 })

    // Escapes headings
    function preprocessMarkdown(text: string): string {
      if (!isUser) return text
      return text.replace(/^#{1,6} /gm, (match) => `\\${match}`)
    }

    function extractCodeLines(node: { children: { children: any[] }[] }) {
      const codeLines: any[] = []

      // Helper function to extract text recursively from children
      function getTextFromNode(node: {
        type: string
        value: any
        children: any[]
      }): string {
        if (node.type === 'text') {
          return node.value
        } else if (node.children) {
          return node.children.map(getTextFromNode).join('')
        }
        return ''
      }

      // Traverse each line in the <code> block
      node.children[0].children.forEach(
        (lineNode: {
          type: string
          tagName: string
          value: any
          children: any[]
        }) => {
          if (lineNode.type === 'element' && lineNode.tagName === 'span') {
            const lineContent = getTextFromNode(lineNode)
            codeLines.push(lineContent)
          }
        }
      )

      // Join the lines with newline characters for proper formatting
      return codeLines.join('\n')
    }
    function wrapCodeBlocksWithoutVisit() {
      return (tree: { children: any[] }) => {
        tree.children = tree.children.map((node) => {
          if (node.tagName === 'pre' && node.children[0]?.tagName === 'code') {
            const language =
              node.children[0].properties.className?.[1]?.replace(
                'language-',
                ''
              )

            if (extractCodeLines(node) === '') {
              return node
            }

            return {
              type: 'element',
              tagName: 'div',
              properties: {
                className: ['code-block-wrapper'],
              },
              children: [
                {
                  type: 'element',
                  tagName: 'div',
                  properties: {
                    className: [
                      'code-block',
                      'group/item',
                      'relative',
                      'overflow-auto',
                    ],
                  },
                  children: [
                    {
                      type: 'element',
                      tagName: 'div',
                      properties: {
                        className:
                          'code-header bg-[hsla(var(--app-code-block))] flex justify-between items-center py-2 px-3 border-b border-[hsla(var(--app-border))] rounded-t-lg',
                      },
                      children: [
                        {
                          type: 'element',
                          tagName: 'span',
                          properties: {
                            className:
                              'text-xs font-medium dark text-[hsla(var(--text-primary))]',
                          },
                          children: [
                            {
                              type: 'text',
                              value: language
                                ? `${getLanguageFromExtension(language)}`
                                : '',
                            },
                          ],
                        },
                        {
                          type: 'element',
                          tagName: 'button',
                          properties: {
                            className:
                              'copy-button ml-auto flex items-center gap-1 text-xs font-medium text-[hsla(var(--text-primary))] focus:outline-none',
                            onClick: (event: Event) => {
                              clipboard.copy(extractCodeLines(node))

                              const button = event.currentTarget as HTMLElement
                              button.innerHTML = `
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check pointer-events-none text-green-600"><path d="M20 6 9 17l-5-5"/></svg>
                                <span>Copied</span>
                              `

                              setTimeout(() => {
                                button.innerHTML = `
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy pointer-events-none text-[hsla(var(--text-primary))]"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                                  <span>Copy</span>
                                `
                              }, 2000)
                            },
                          },
                          children: [
                            {
                              type: 'element',
                              tagName: 'svg',
                              properties: {
                                xmlns: 'http://www.w3.org/2000/svg',
                                width: '16',
                                height: '16',
                                viewBox: '0 0 24 24',
                                fill: 'none',
                                stroke: 'currentColor',
                                strokeWidth: '2',
                                strokeLinecap: 'round',
                                strokeLinejoin: 'round',
                                className:
                                  'lucide lucide-copy pointer-events-none text-[hsla(var(--text-primary))]',
                              },
                              children: [
                                {
                                  type: 'element',
                                  tagName: 'rect',
                                  properties: {
                                    width: '14',
                                    height: '14',
                                    x: '8',
                                    y: '8',
                                    rx: '2',
                                    ry: '2',
                                  },
                                  children: [],
                                },
                                {
                                  type: 'element',
                                  tagName: 'path',
                                  properties: {
                                    d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
                                  },
                                  children: [],
                                },
                              ],
                            },
                            { type: 'text', value: 'Copy' },
                          ],
                        },
                      ],
                    },
                    node,
                  ],
                },
              ],
            }
          }
          return node
        })
      }
    }
    return (
      <>
        <Markdown
          className={twMerge('markdown-content', className)}
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={
            [
              rehypeHighlight,
              renderKatex ? [rehypeKatex, { throwOnError: false }] : undefined,
              [rehypeHighlightCodeLines, { showLineNumbers: true }],
              wrapCodeBlocksWithoutVisit,
            ].filter(Boolean) as any
          }
          components={markdownComponents}
        >
          {preprocessMarkdown(text)}
        </Markdown>
      </>
    )
  }
)
