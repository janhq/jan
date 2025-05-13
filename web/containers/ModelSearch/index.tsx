import React, { ChangeEvent, useCallback, useState, useRef } from 'react'

import { Input } from '@janhq/joi'
import { SearchIcon } from 'lucide-react'

import { useDebouncedCallback } from 'use-debounce'

type Props = {
  onSearchLocal?: (searchText: string) => void
}

const ModelSearch = ({ onSearchLocal }: Props) => {
  const [searchText, setSearchText] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const debounced = useDebouncedCallback(async () => {
    if (searchText.indexOf('/') === -1) {
      // If we don't find / in the text, perform a local search
      onSearchLocal?.(searchText)
      return
    }
    // Attempt to search local
    onSearchLocal?.(searchText)
  }, 300)

  const onSearchChanged = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setSearchText(e.target.value)
      debounced()
    },
    [debounced]
  )

  const onClear = useCallback(() => {
    setSearchText('')
    debounced()
  }, [debounced])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        debounced()
      }
    },
    [debounced]
  )

  return (
    <Input
      ref={inputRef}
      prefixIcon={<SearchIcon size={16} />}
      placeholder="Search models..."
      onChange={onSearchChanged}
      onKeyDown={onKeyDown}
      value={searchText}
      clearable={searchText.length > 0}
      onClear={onClear}
      className="border-1 bg-[hsla(var(--app-bg))]"
      onClick={() => {
        onSearchLocal?.(inputRef.current?.value ?? '')
      }}
    />
  )
}

export default ModelSearch
