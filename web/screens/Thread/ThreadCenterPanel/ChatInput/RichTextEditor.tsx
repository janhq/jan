/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, ClipboardEvent } from 'react'

import { MessageStatus } from '@janhq/core'
import { useAtom, useAtomValue } from 'jotai'

import { BaseEditor, createEditor, Editor, Range, Transforms } from 'slate'
import { withHistory } from 'slate-history' // Import withHistory
import {
  Editable,
  ReactEditor,
  Slate,
  withReact,
  RenderLeafProps,
} from 'slate-react'

import { twMerge } from 'tailwind-merge'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { useActiveModel } from '@/hooks/useActiveModel'
import useSendChatMessage from '@/hooks/useSendChatMessage'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import {
  getActiveThreadIdAtom,
  activeSettingInputBoxAtom,
} from '@/helpers/atoms/Thread.atom'

type CustomElement = {
  type: 'paragraph' | 'code' | null
  children: CustomText[]
  language?: string // Store the language for code blocks
}
type CustomText = {
  text: string
  code?: boolean
  language?: string
  className?: string
  type?: 'paragraph' | 'code' // Add the type property
  format?: 'bold' | 'italic'
}

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor
    Element: CustomElement
    Text: CustomText
  }
}

const initialValue: CustomElement[] = [
  {
    type: 'paragraph',
    children: [{ text: '' }],
  },
]

type RichTextEditorProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const RichTextEditor = ({
  className,
  style,
  disabled,
  placeholder,
  spellCheck,
}: RichTextEditorProps) => {
  const editor = useMemo(() => withHistory(withReact(createEditor())), [])
  const currentLanguage = useRef<string>('plaintext')
  const hasStartBackticks = useRef<boolean>(false)
  const hasEndBackticks = useRef<boolean>(false)

  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)
  const textareaRef = useRef<HTMLDivElement>(null)
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const activeSettingInputBox = useAtomValue(activeSettingInputBoxAtom)
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const { sendChatMessage } = useSendChatMessage()
  const { stopInference } = useActiveModel()
  const selectedModel = useAtomValue(selectedModelAtom)
  const largeContentThreshold = 1000

  // The decorate function identifies code blocks and marks the ranges
  const decorate = useCallback(
    (entry: [any, any]) => {
      const ranges: any[] = []
      const [node, path] = entry

      if (Editor.isBlock(editor, node) && node.type === 'paragraph') {
        node.children.forEach((child: { text: any }, childIndex: number) => {
          const text = child.text

          // Match bold text pattern *text*
          const boldMatches = [...text.matchAll(/(\*.*?\*)/g)] // Find bold patterns
          boldMatches.forEach((match) => {
            const startOffset = match.index + 1 || 0
            const length = match[0].length - 2

            ranges.push({
              anchor: { path: [...path, childIndex], offset: startOffset },
              focus: {
                path: [...path, childIndex],
                offset: startOffset + length,
              },
              format: 'italic',
              className: 'italic',
            })
          })
        })
      }

      if (Editor.isBlock(editor, node) && node.type === 'paragraph') {
        node.children.forEach((child: { text: any }, childIndex: number) => {
          const text = child.text

          // Match bold text pattern **text**
          const boldMatches = [...text.matchAll(/(\*\*.*?\*\*)/g)] // Find bold patterns
          boldMatches.forEach((match) => {
            const startOffset = match.index + 2 || 0
            const length = match[0].length - 4

            ranges.push({
              anchor: { path: [...path, childIndex], offset: startOffset },
              focus: {
                path: [...path, childIndex],
                offset: startOffset + length,
              },
              format: 'bold',
              className: 'font-bold',
            })
          })
        })
      }

      return ranges
    },
    [editor]
  )

  // RenderLeaf applies the decoration styles
  const renderLeaf = useCallback(
    ({ attributes, children, leaf }: RenderLeafProps) => {
      if (leaf.format === 'italic') {
        return (
          <i className={leaf.className} {...attributes}>
            {children}
          </i>
        )
      }
      if (leaf.format === 'bold') {
        return (
          <strong className={leaf.className} {...attributes}>
            {children}
          </strong>
        )
      }
      if (leaf.code) {
        // Apply syntax highlighting to code blocks
        return (
          <code className={leaf.className} {...attributes}>
            {children}
          </code>
        )
      }

      return <span {...attributes}>{children}</span>
    },
    []
  )

  useEffect(() => {
    if (!ReactEditor.isFocused(editor)) {
      ReactEditor.focus(editor)
    }
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [activeThreadId, editor])

  useEffect(() => {
    if (textareaRef.current?.clientHeight) {
      textareaRef.current.style.height = activeSettingInputBox
        ? '100px'
        : '40px'
      textareaRef.current.style.height =
        textareaRef.current.scrollHeight + 2 + 'px'
      textareaRef.current.style.overflow =
        textareaRef.current.clientHeight >= 390 ? 'auto' : 'hidden'
    }

    if (currentPrompt.length === 0) {
      resetEditor()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textareaRef.current?.clientHeight, currentPrompt, activeSettingInputBox])

  const onStopInferenceClick = async () => {
    stopInference()
  }

  const resetEditor = useCallback(() => {
    Transforms.delete(editor, {
      at: {
        anchor: Editor.start(editor, []),
        focus: Editor.end(editor, []),
      },
    })

    // Adjust the height of the textarea to its initial state
    if (textareaRef.current) {
      textareaRef.current.style.height = activeSettingInputBox
        ? '100px'
        : '44px'
      textareaRef.current.style.overflow = 'hidden' // Reset overflow style
    }

    // Ensure the editor re-renders decorations
    editor.onChange()
  }, [activeSettingInputBox, editor])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        event.nativeEvent.isComposing === false
      ) {
        event.preventDefault()
        if (messages[messages.length - 1]?.status !== MessageStatus.Pending) {
          sendChatMessage(currentPrompt)
          if (selectedModel) {
            resetEditor()
          }
        } else onStopInferenceClick()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentPrompt, editor, messages]
  )

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const clipboardData = event.clipboardData || (window as any).clipboardData
    const pastedData = clipboardData.getData('text')

    if (pastedData.length > largeContentThreshold) {
      event.preventDefault() // Prevent the default paste behavior
      Transforms.insertText(editor, pastedData) // Insert the content directly into the editor
    }
  }

  return (
    <Slate
      editor={editor}
      initialValue={initialValue}
      onChange={(value) => {
        const combinedText = value
          .map((block) => {
            if ('children' in block) {
              return block.children.map((child) => child.text).join('')
            }
            return ''
          })
          .join('\n')

        setCurrentPrompt(combinedText)
        if (combinedText.trim() === '') {
          currentLanguage.current = 'plaintext'
        }
        const hasCodeBlockStart = combinedText.match(/^```(\w*)/m)
        const hasCodeBlockEnd = combinedText.match(/^```$/m)

        // Set language to plaintext if no code block with language identifier is found
        if (!hasCodeBlockStart) {
          currentLanguage.current = 'plaintext'
          hasStartBackticks.current = false
        } else {
          hasStartBackticks.current = true
        }
        if (!hasCodeBlockEnd) {
          currentLanguage.current = 'plaintext'
          hasEndBackticks.current = false
        } else {
          hasEndBackticks.current = true
        }
      }}
    >
      <Editable
        ref={textareaRef}
        decorate={(entry) => {
          // Skip decorate if content exceeds threshold
          if (
            currentPrompt.length > largeContentThreshold ||
            !currentPrompt.length
          )
            return []
          return decorate(entry)
        }}
        renderLeaf={renderLeaf} // Pass the renderLeaf function
        scrollSelectionIntoView={scrollSelectionIntoView}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste} // Add the custom paste handler
        className={twMerge(
          className,
          disabled &&
            'cursor-not-allowed border-none bg-[hsla(var(--disabled-bg))] text-[hsla(var(--disabled-fg))]'
        )}
        placeholder={placeholder}
        style={style}
        disabled={disabled}
        readOnly={disabled}
        spellCheck={spellCheck}
      />
    </Slate>
  )

  function scrollSelectionIntoView(
    editor: ReactEditor,
    domRange: globalThis.Range
  ) {
    // This was affecting the selection of multiple blocks and dragging behavior,
    // so enabled only if the selection has been collapsed.
    if (editor.selection && Range.isExpanded(editor.selection)) return

    const minTop = 80 // sticky header height

    const leafEl = domRange.startContainer.parentElement
    const scrollParent = getScrollParent(leafEl)

    // Check if browser supports getBoundingClientRect
    if (typeof domRange.getBoundingClientRect !== 'function') return

    const { top: elementTop, height: elementHeight } =
      domRange.getBoundingClientRect()
    const { height: parentHeight } = scrollParent.getBoundingClientRect()

    const isChildAboveViewport = elementTop < minTop
    const isChildBelowViewport = elementTop + elementHeight > parentHeight

    if (isChildAboveViewport && isChildBelowViewport) {
      // Child spans through all visible area which means it's already in view.
      return
    }

    if (isChildAboveViewport) {
      const y = scrollParent.scrollTop + elementTop - minTop
      scrollParent.scroll({ left: scrollParent.scrollLeft, top: y })
      return
    }

    if (isChildBelowViewport) {
      const y = Math.min(
        scrollParent.scrollTop + elementTop - minTop,
        scrollParent.scrollTop + elementTop + elementHeight - parentHeight
      )
      scrollParent.scroll({ left: scrollParent.scrollLeft, top: y })
    }
  }

  function getScrollParent(element: any) {
    const elementStyle = window.getComputedStyle(element)
    const excludeStaticParent = elementStyle.position === 'absolute'

    if (elementStyle.position === 'fixed') {
      return document.body
    }

    let parent = element

    while (parent) {
      const parentStyle = window.getComputedStyle(parent)

      if (parentStyle.position !== 'static' || !excludeStaticParent) {
        const overflowAttributes = [
          parentStyle.overflow,
          parentStyle.overflowY,
          parentStyle.overflowX,
        ]

        if (
          overflowAttributes.includes('auto') ||
          overflowAttributes.includes('hidden')
        ) {
          return parent
        }
      }

      parent = parent.parentElement
    }

    return document.documentElement
  }
}

export default RichTextEditor
