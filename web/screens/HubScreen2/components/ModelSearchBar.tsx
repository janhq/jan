import React, { useCallback, useState } from 'react'

import { Button, Input } from '@janhq/joi'
import { useSetAtom } from 'jotai'
import { SearchIcon } from 'lucide-react'
import { FoldersIcon } from 'lucide-react'
import { useDebouncedCallback } from 'use-debounce'

import { toaster } from '@/containers/Toast'

import { useGetHFRepoData } from '@/hooks/useGetHFRepoData'

import { MainViewState, mainViewStateAtom } from '@/helpers/atoms/App.atom'
import {
  importHuggingFaceModelStageAtom,
  importingHuggingFaceRepoDataAtom,
} from '@/helpers/atoms/HuggingFace.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

type Props = {
  onSearchChanged: (query: string) => void
}

const ModelSearchBar: React.FC<Props> = ({ onSearchChanged }) => {
  const [searchText, setSearchText] = useState('')
  const { getHfRepoData } = useGetHFRepoData()
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const setSelectedSetting = useSetAtom(selectedSettingAtom)

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
      <Input
        className="w-full bg-[hsla(var(--app-bg))] md:w-[320px]"
        prefixIcon={<SearchIcon size={16} />}
        placeholder="Search or paste Hugging Face URL"
        value={searchText}
        onChange={onQueryChanged}
      />
      <Button
        className="flex gap-2 bg-[hsla(var(--app-bg))] text-[hsla(var(--text-primary))]"
        theme="ghost"
        onClick={() => {
          setMainViewState(MainViewState.Settings)
          setSelectedSetting('My Models')
        }}
      >
        <FoldersIcon size={16} />
        <span>My models</span>
      </Button>
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
