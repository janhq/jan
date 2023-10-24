'use client'

import { searchingModelText } from '@helpers/JotaiWrapper'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { useSetAtom } from 'jotai'
import { useEffect, useState } from 'react'

const ModelSearchBar: React.FC = () => {
  const setSearchtext = useSetAtom(searchingModelText)
  const [text, setText] = useState('')
  useEffect(() => {
    setSearchtext(text)
  }, [text, setSearchtext])
  return (
    <div className="flex items-center justify-center py-[27px]">
      <div className="flex h-[42px] w-[520px] items-center">
        <input
          className="h-full flex-1 rounded-bl-lg rounded-tl-lg border border-gray-300 bg-gray-300 px-4 py-3 text-sm leading-[17.5px] outline-none"
          placeholder="Search model"
          value={text}
          onChange={(text) => setText(text.currentTarget.value)}
        />
        <button className="flex h-[42px] w-[42px] items-center justify-center rounded-br-lg rounded-tr-lg border border-gray-800 bg-gray-800 p-2">
          <MagnifyingGlassIcon width={20} height={20} color="#FFFFFF" />
        </button>
      </div>
    </div>
  )
}

export default ModelSearchBar
