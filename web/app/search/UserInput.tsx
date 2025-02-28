import React, { useState, useRef, useEffect } from 'react'

import { Button } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import { Send } from 'lucide-react'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { selectedTextAtom } from '@/containers/Providers/Jotai'

import SelectedText from './SelectedText'

const UserInput = () => {
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const selectedText = useAtomValue(selectedTextAtom)

  useEffect(() => {
    inputRef.current?.focus()
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.core?.api?.hideQuickAskWindow()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const handleChange = (
    event:
      | React.ChangeEvent<HTMLInputElement>
      | React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    const { value } = event.target
    setInputValue(value)
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputValue.trim() !== '') {
      const fullText = `${inputValue} ${selectedText}`.trim()
      window.core?.api?.sendQuickAskInput(fullText)
      setInputValue('')
      window.core?.api?.hideQuickAskWindow()
      window.core?.api?.showMainWindow()
    }
  }

  return (
    <div className="flex flex-col space-y-3 bg-[hsla(var(--app-bg))] p-3">
      <form
        ref={formRef}
        className="flex h-full w-full items-center justify-center"
        onSubmit={onSubmit}
      >
        <div className="flex h-full w-full items-center gap-4">
          <LogoMark width={28} height={28} className="mx-auto" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent font-bold text-[hsla(var(--text-primary))] focus:outline-none"
            type="text"
            value={inputValue}
            onChange={handleChange}
            placeholder="Ask me anything"
          />
          <Button onClick={onSubmit}>
            <Send size={16} />
          </Button>
        </div>
      </form>
      <SelectedText onCleared={() => inputRef?.current?.focus()} />
    </div>
  )
}

export default UserInput
