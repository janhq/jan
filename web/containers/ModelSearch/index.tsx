import React, { ChangeEvent, useCallback, useState } from 'react'

import { Input } from '@janhq/joi'
import { useSetAtom } from 'jotai'
import { SearchIcon } from 'lucide-react'
import { useDebouncedCallback } from 'use-debounce'

import { toaster } from '@/containers/Toast'

import { useGetHFRepoData } from '@/hooks/useGetHFRepoData'

import {
  importHuggingFaceModelStageAtom,
  importingHuggingFaceRepoDataAtom,
} from '@/helpers/atoms/HuggingFace.atom'

type Props = {
  onSearchLocal?: (searchText: string) => void
}

const ModelSearch = ({ onSearchLocal }: Props) => {
  const [searchText, setSearchText] = useState('')
  const { loading, getHfRepoData } = useGetHFRepoData()

  const setImportingHuggingFaceRepoData = useSetAtom(
    importingHuggingFaceRepoDataAtom
  )
  const setImportHuggingFaceModelStage = useSetAtom(
    importHuggingFaceModelStageAtom
  )

  const debounced = useDebouncedCallback(async () => {
    if (searchText.indexOf('/') === -1) {
      // If we don't find / in the text, perform a local search
      onSearchLocal?.(searchText)
      return
    }

    try {
      const data = await getHfRepoData(searchText)
      setImportingHuggingFaceRepoData(data)
      setImportHuggingFaceModelStage('REPO_DETAIL')
    } catch (err) {
      let errMessage = 'Unexpected Error'
      if (err instanceof Error) {
        errMessage = err.message
      }
      toaster({
        title: 'Failed to get Hugging Face models',
        description: errMessage,
        type: 'error',
      })
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
    <Input
      prefixIcon={<SearchIcon size={16} />}
      placeholder="Search or paste Hugging Face URL"
      onChange={onSearchChanged}
      onKeyDown={onKeyDown}
    />
  )
}

export default ModelSearch
