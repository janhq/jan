import { Button, Modal } from '@janhq/joi'
import { StrictMode, useEffect, useState } from 'react'
import * as React from 'react'
import { events, MessageEvent, ThreadMessage } from '@janhq/core'
import {
  LiveProvider,
  LiveEditor,
  LiveError,
  LivePreview,
} from 'react-live-runner'

const scope = {
  // scope used by import statement
  import: {
    react: React,
  },
}

export const CodePreviewTab = () => {
  const [code, setCode] = useState<string | undefined>()

  useEffect(() => {
    setCode(localStorage.getItem('latest_preview_code') ?? '')
  }, [])

  useEffect(() => {
    events.on(MessageEvent.OnMessageUpdate, (data: ThreadMessage) => {
      const extractedCode = extractCode(data.content[0]?.text.value ?? '')
      if (extractedCode && extractedCode.length > 0) {
        setCode(extractedCode)
        localStorage.setItem('latest_preview_code', extractedCode)
      }
    })
  }, [setCode])


  // Parse all code blocks
  function extractCode(text: string): string | undefined {
    // Match content between ``` and ```
    const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)\n```/

    const match = text.match(codeBlockRegex)
    if (match) {
      return match[1].trim()
    }

    return undefined
  }

  return (
    <StrictMode>
      <LiveProvider code={code} scope={scope}>
        <LiveEditor />
        <LivePreview />
        <LiveError />
      </LiveProvider>
    </StrictMode>
  )
}

export const SetupView = () => {
  return (
    <StrictMode>
      <h4>Hello!</h4>
      <Modal
        trigger={<Button>Click Me Open Modal</Button>}
        content={
          <p>
            Lorem ipsum dolor sit amet consectetur adipisicing elit. Recusandae
            alias libero dolorem! Quas alias, earum tempore veniam harum itaque
            corporis ipsa inventore veritatis cupiditate, aperiam sint odit
            quisquam ipsam debitis.
          </p>
        }
      />
    </StrictMode>
  )
}
