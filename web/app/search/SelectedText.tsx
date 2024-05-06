import React, { useCallback, useEffect, useRef } from 'react'

import { useAtom } from 'jotai'
import { X } from 'lucide-react'

import { selectedTextAtom } from '@/containers/Providers/Jotai'

const SelectedText = ({ onCleared }: { onCleared?: () => void }) => {
  const [text, setText] = useAtom(selectedTextAtom)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (window.core?.api?.quickAskSizeUpdated !== 'function') return
    if (text.trim().length === 0) {
      window.core?.api?.quickAskSizeUpdated(0)
    } else {
      window.core?.api?.quickAskSizeUpdated(
        (containerRef.current?.offsetHeight ?? 0) + 14
      )
    }
  })

  const onClearClicked = useCallback(() => {
    setText('')
    onCleared?.()
  }, [setText, onCleared])

  const shouldShowSelectedText = text.trim().length > 0

  return shouldShowSelectedText ? (
    <div
      ref={containerRef}
      className="relative rounded-lg border border-[hsla(var(--app-border))] bg-secondary p-[10px]"
    >
      <div
        className="absolute right-2 top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-[hsla(var(--app-border))] bg-white shadow dark:bg-black/80"
        onClick={onClearClicked}
      >
        <X size={14} className="text-[hsla(var(--app-text-secondary)]" />
      </div>
      <p className="text-[hsla(var(--app-text-secondary)] pr-8 font-medium">
        {text}
      </p>
    </div>
  ) : (
    <div />
  )
}

export default SelectedText
