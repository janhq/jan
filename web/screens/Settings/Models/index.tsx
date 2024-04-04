import { ChangeEvent, useCallback, useMemo } from 'react'

import { useDropzone } from 'react-dropzone'

import { Button, Input, ScrollArea } from '@janhq/uikit'

import { useAtomValue, useSetAtom } from 'jotai'
import { Plus, SearchIcon, UploadCloudIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { useDebouncedCallback } from 'use-debounce'

import useDropModelBinaries from '@/hooks/useDropModelBinaries'
import { useGetHFRepoData } from '@/hooks/useGetHFRepoData'
import { setImportModelStageAtom } from '@/hooks/useImportModel'

import RowModel from './Row'

import {
  importHuggingFaceModelStageAtom,
  importingHuggingFaceRepoDataAtom,
} from '@/helpers/atoms/HuggingFace.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
const Column = ['Name', 'Model ID', 'Size', 'Version', 'Status', '']

const Models: React.FC = () => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const { onDropModels } = useDropModelBinaries()
  const { loading, getHfRepoData } = useGetHFRepoData()

  const setImportingHuggingFaceRepoData = useSetAtom(
    importingHuggingFaceRepoDataAtom
  )
  const setImportHuggingFaceModelStage = useSetAtom(
    importHuggingFaceModelStageAtom
  )

  const debounced = useDebouncedCallback(async (value: string) => {
    if (value.trim().length === 0) return
    try {
      const data = await getHfRepoData(value)
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
      debounced(e.target.value)
    },
    [debounced]
  )

  const filteredDownloadedModels = useMemo(
    () => downloadedModels.sort((a, b) => a.name.localeCompare(b.name)),
    [downloadedModels]
  )

  const { getRootProps, isDragActive } = useDropzone({
    noClick: true,
    multiple: true,
    onDrop: onDropModels,
  })

  const onImportModelClick = useCallback(() => {
    setImportModelStage('SELECTING_MODEL')
  }, [setImportModelStage])

  return (
    <ScrollArea className="h-full w-full" {...getRootProps()}>
      {isDragActive && (
        <div className="absolute z-50 mx-auto h-full w-full bg-background/50 p-8 backdrop-blur-lg">
          <div
            className={twMerge(
              'flex h-full w-full items-center justify-center rounded-lg border border-dashed border-blue-500'
            )}
          >
            <div className="mx-auto w-1/2 text-center">
              <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-200">
                <UploadCloudIcon size={24} className="text-blue-600" />
              </div>
              <div className="mt-4 text-blue-600">
                <h6 className="font-bold">Drop file here</h6>
                <p className="mt-2">File (GGUF) or folder</p>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="m-4 rounded-xl border border-border shadow-sm">
        <div className="flex flex-row justify-between px-6 py-5">
          <div className="relative w-1/3">
            <SearchIcon
              size={20}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <div className="flex flex-row items-center space-x-4">
              <Input
                placeholder="Search or paste Hugging Face URL"
                className="pl-8"
                onChange={onSearchChanged}
              />
              {loading && (
                <svg
                  aria-hidden="true"
                  role="status"
                  className="btn-loading-circle"
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
          </div>

          <Button
            themes={'outline'}
            className="space-x-2"
            onClick={onImportModelClick}
          >
            <Plus className="h-3 w-3" />
            <p>Import Model</p>
          </Button>
        </div>
        <table className="relative w-full px-8">
          <thead className="w-full border-b border-border bg-secondary">
            <tr>
              {Column.map((col) => (
                <th
                  key={col}
                  className="px-6 py-2 text-left font-normal last:text-center"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredDownloadedModels
              ? filteredDownloadedModels.map((x) => (
                  <RowModel key={x.id} data={x} />
                ))
              : null}
          </tbody>
        </table>
      </div>
    </ScrollArea>
  )
}

export default Models
