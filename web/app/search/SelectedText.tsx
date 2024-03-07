import React, { useCallback, useEffect, useRef } from 'react'

import { useAtom } from 'jotai'
import { X } from 'lucide-react'

import { selectedTextAtom } from '@/containers/Providers/Jotai'

const SelectedText = ({ onCleared }: { onCleared?: () => void }) => {
  const [text, setText] = useAtom(selectedTextAtom)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
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
      className="relative rounded-lg border-[1px] border-[#0000000F] bg-[#0000000A] p-[10px]"
    >
      <div
        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border-[1px] border-[#0000000F] bg-white drop-shadow"
        onClick={onClearClicked}
      >
        <X size={16} />
      </div>
      <p className="font-semibold text-[#00000099]">{text}</p>
    </div>
  ) : (
    <div />
  )
}

export default SelectedText
