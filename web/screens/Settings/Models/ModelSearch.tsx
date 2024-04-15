import React, { ChangeEvent, useCallback, useState } from 'react'

import { Input } from '@janhq/uikit'
import { useSetAtom } from 'jotai'
import { SearchIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'
import { useDebouncedCallback } from 'use-debounce'

import { useGetHFRepoData } from '@/hooks/useGetHFRepoData'

import {
  importHuggingFaceModelStageAtom,
  importingHuggingFaceRepoDataAtom,
} from '@/helpers/atoms/HuggingFace.atom'

const ModelSearch: React.FC = () => {
  const [searchText, setSearchText] = useState('')
  const { loading, getHfRepoData } = useGetHFRepoData()

  const setImportingHuggingFaceRepoData = useSetAtom(
    importingHuggingFaceRepoDataAtom
  )
  const setImportHuggingFaceModelStage = useSetAtom(
    importHuggingFaceModelStageAtom
  )

  const debounced = useDebouncedCallback(async () => {
    if (searchText.trim().length === 0) return
    try {
      const data = await getHfRepoData(searchText)
      setImportingHuggingFaceRepoData(data)
      setImportHuggingFaceModelStage('REPO_DETAIL')
    } catch (err) {
      // TODO: might need to display popup
      console.error(err)
    }
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
    <div className="relative w-[320px]">
      <SearchIcon
        size={20}
        className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <div className="flex flex-row items-center space-x-4">
        <Input
          placeholder="Search or paste Hugging Face URL"
          className={twMerge('pl-8', loading ? 'pr-8' : '')}
          onChange={onSearchChanged}
          onKeyDown={onKeyDown}
        />
      </div>
      {loading && (
        <svg
          aria-hidden="true"
          role="status"
          className="btn-loading-circle absolute right-1 top-1/4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      )}
    </div>
  )
}

export default ModelSearch
