import React, { useCallback, useState } from 'react'

import { useSetAtom } from 'jotai'
import { Search } from 'lucide-react'
import { useDebouncedCallback } from 'use-debounce'

import { toaster } from '@/containers/Toast'

import { useGetHFRepoData } from '@/hooks/useGetHFRepoData'

import {
  importHuggingFaceModelStageAtom,
  importingHuggingFaceRepoDataAtom,
} from '@/helpers/atoms/HuggingFace.atom'

type Props = {
  onSearchChanged: (query: string) => void
}

const ModelSearchBar: React.FC<Props> = ({ onSearchChanged }) => {
  const [searchText, setSearchText] = useState('')
  const { getHfRepoData } = useGetHFRepoData()

  const setImportingHuggingFaceRepoData = useSetAtom(
    importingHuggingFaceRepoDataAtom
  )
  const setImportHuggingFaceModelStage = useSetAtom(
    importHuggingFaceModelStageAtom
  )

  const debounced = useDebouncedCallback(async (searchText: string) => {
    if (searchText.indexOf('/') === -1) {
      // If we don't find / in the text, perform a local search
      onSearchChanged?.(searchText)
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

  const onQueryChanged = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const text = e.target.value
      setSearchText(text)
      debounced(text)
    },
    [debounced]
  )

  return (
    <div className="mx-4 mt-4 flex h-[128px] items-center justify-center gap-3 rounded-[10px] bg-blue-400">
      <div className="flex h-8 w-full max-w-[320px] items-center gap-2 rounded-md border bg-[hsla(var(--app-bg))] p-2">
        <Search size={16} />
        <input
          className="flex-1 outline-none"
          placeholder="Search or enter Hugging Face model URL"
          value={searchText}
          onChange={onQueryChanged}
        />
      </div>
      {/* <Button className="flex items-center gap-2"> */}
      {/*   <Upload size={16} /> */}
      {/*   <span className="hidden text-sm font-semibold md:block"> */}
      {/*     Import model */}
      {/*   </span> */}
      {/* </Button> */}
    </div>
  )
}

export default ModelSearchBar
