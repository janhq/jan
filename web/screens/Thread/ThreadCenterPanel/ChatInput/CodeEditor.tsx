import { useCallback, useState } from 'react'

import {
  BaseEditor,
  BaseRange,
  createEditor,
  Descendant,
  Transforms,
  Element,
  Editor,
} from 'slate'
import {
  Editable,
  ReactEditor,
  Slate,
  withReact,
  RenderLeafProps,
} from 'slate-react'

type CustomElement = { type: 'paragraph' | 'codeblock'; children: CustomText[] }
type CustomText = { text: string; code?: boolean }

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
    children: [{ text: 'A line of text in a paragraph.' }],
  },
]

const App = () => {
  const [editor] = useState(() => withReact(createEditor()))

  const renderLeaf = useCallback(
    ({ attributes, children, leaf }: RenderLeafProps) => {
      if (leaf.code) {
        return (
          <span className="text-green-500" {...attributes}>
            {children}
          </span>
        )
      }

      return <span {...attributes}>{children}</span>
    },
    []
  )

  const handleChange = (value: Descendant[]) => {
    const paragraphs = value.filter(
      (node) => (node as CustomElement).type === 'paragraph'
    )
    let inCodeBlock = false // Flag to track if we are inside a code block
    let codeBlockNodes: Descendant[] = [] // Array to hold nodes between backticks

    paragraphs.forEach((node, nodeIndex) => {
      if ('children' in node) {
        node.children.forEach((child, childIndex) => {
          const text = child.text

          // Check for the start backtick
          if (text === '```') {
            if (!inCodeBlock) {
              // We found the start of a code block
              inCodeBlock = true
              return // Skip to next node
            } else {
              // We found the end of a code block
              inCodeBlock = false
              // Log or process the collected nodes in codeBlockNodes
              console.log('Code block nodes:', codeBlockNodes)

              codeBlockNodes = [] // Reset for the next block
              return // Skip to next node
            }
          }

          // If we are inside a code block, add the node to codeBlockNodes
          if (inCodeBlock) {
            Transforms.setNodes(
              editor,
              { code: true },
              { at: [nodeIndex, childIndex], match: (n) => n === child }
            )
            codeBlockNodes.push({
              text: text,
              code: true, // Mark the text as code
            })
          }
        })
      }
    })

    // Handle case where the editor ends in a code block (if needed)
    if (inCodeBlock) {
      console.log('Incomplete code block:', codeBlockNodes)
    }
  }

  const useDecorate = (editor) => {
    return useCallback(
      ([node, path]) => {
        console.log('node', node)
        if (Element.isElement(node)) {
          // Assuming you want to return an empty array as a default
          if (node.children[0].text !== '```') {
            Transforms.setNodes(editor, { code: false })
          }
          return []
        }

        return []
      },
      [editor.nodeToDecorations]
    )
  }

  const decorate = useDecorate(editor)

  return (
    <Slate editor={editor} initialValue={initialValue} onChange={handleChange}>
      <Editable
        decorate={decorate}
        renderLeaf={renderLeaf}
        className="mb-4 h-40 rounded-lg border border-[hsla(var(--app-border))] p-4"
      />
    </Slate>
  )
}

export default App
