import { useCallback, useMemo, useState } from 'react'

import { useDropzone } from 'react-dropzone'

import { InferenceEngine } from '@janhq/core'

import { Button, ScrollArea } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'
import { UploadCloudIcon, UploadIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import ModelSearch from '@/containers/ModelSearch'

import SetupRemoteModel from '@/containers/SetupRemoteModel'

import useDropModelBinaries from '@/hooks/useDropModelBinaries'
import { setImportModelStageAtom } from '@/hooks/useImportModel'

import MyModelList from './MyModelList'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

const MyModels = () => {
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

  const findByEngine = filteredDownloadedModels.map((x) => x.engine)
  const groupByEngine = findByEngine.filter(function (item, index) {
    if (findByEngine.indexOf(item) === index)
      return item !== InferenceEngine.nitro
  })

  return (
    <div {...getRootProps()} className="w-full">
      <ScrollArea className="h-full w-full">
        {isDragActive && (
          <div className="absolute z-50 mx-auto h-full w-full bg-[hsla(var(--app-bg))]/50 p-8 backdrop-blur-lg">
            <div
              className={twMerge(
                'flex h-full w-full items-center justify-center rounded-lg border border-dashed border-[hsla(var(--app-border))]'
              )}
            >
              <div className="mx-auto w-1/2 text-center">
                <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full">
                  <UploadCloudIcon size={24} />
                </div>
                <div className="mt-4 ">
                  <h6 className="font-bold">Drop file here</h6>
                  <p className="mt-2">File (GGUF) or folder</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="m-4 rounded-xl">
          <div className="flex flex-col justify-between gap-2 sm:flex-row">
            <div className="w-full sm:w-[300px]">
              <ModelSearch onSearchLocal={onSearchChange} />
            </div>
            <Button
              variant="outline"
              theme="ghost"
              onClick={onImportModelClick}
            >
              <UploadIcon size={16} className="mr-2" />
              <p>Import Model</p>
            </Button>
          </div>

          <div className="relative w-full">
            {filteredDownloadedModels.filter(
              (x) => x.engine === InferenceEngine.nitro
            ).length !== 0 && (
              <div className="my-6">
                <div className="flex flex-col items-start justify-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h6 className="text-base font-semibold">Cortex</h6>
                </div>
                <div className="mt-2">
                  {filteredDownloadedModels
                    ? filteredDownloadedModels
                        .filter((x) => x.engine === InferenceEngine.nitro)
                        .map((model) => {
                          return <MyModelList key={model.id} model={model} />
                        })
                    : null}
                </div>
              </div>
            )}

            {groupByEngine.map((engine, i) => {
              return (
                <div className="my-6" key={i}>
                  <div className="flex flex-col items-start justify-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h6 className="text-base font-semibold capitalize">
                      {engine}
                    </h6>
                    <SetupRemoteModel engine={engine} />
                  </div>
                  <div className="mt-2">
                    {filteredDownloadedModels
                      ? filteredDownloadedModels
                          .filter((x) => x.engine === engine)
                          .map((model) => {
                            return <MyModelList key={model.id} model={model} />
                          })
                      : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

export default MyModels
