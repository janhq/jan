import { useCallback, useMemo, useState } from 'react'

import { useDropzone } from 'react-dropzone'

import { Button, ScrollArea } from '@janhq/uikit'

import { useAtomValue, useSetAtom } from 'jotai'
import { Plus, UploadCloudIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import useDropModelBinaries from '@/hooks/useDropModelBinaries'
import { setImportModelStageAtom } from '@/hooks/useImportModel'

import ModelSearch from './ModelSearch'
import RowModel from './Row'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

const Column = ['Name', 'Model ID', 'Size', 'Version', 'Status', '']

const Models: React.FC = () => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const { onDropModels } = useDropModelBinaries()
  const [searchText, setSearchText] = useState('')

  const filteredDownloadedModels = useMemo(
    () =>
      downloadedModels
        .filter((e) =>
          e.name.toLowerCase().includes(searchText.toLowerCase().trim())
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [downloadedModels, searchText]
  )

  const { getRootProps, isDragActive } = useDropzone({
    noClick: true,
    multiple: true,
    onDrop: onDropModels,
  })

  const onImportModelClick = useCallback(() => {
    setImportModelStage('SELECTING_MODEL')
  }, [setImportModelStage])

  const onSearchChange = useCallback((input: string) => {
    setSearchText(input)
  }, [])

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
          <ModelSearch onSearchLocal={onSearchChange} />
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
