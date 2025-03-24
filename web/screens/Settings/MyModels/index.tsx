import { useCallback, useEffect, useMemo, useState } from 'react'

import { useDropzone } from 'react-dropzone'

import Image from 'next/image'

import { InferenceEngine } from '@janhq/core'

import { Button, ScrollArea } from '@janhq/joi'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  UploadCloudIcon,
  UploadIcon,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import BlankState from '@/containers/BlankState'
import ModelSearch from '@/containers/ModelSearch'

import SetupRemoteModel from '@/containers/SetupRemoteModel'

import useDropModelBinaries from '@/hooks/useDropModelBinaries'
import { useGetEngines } from '@/hooks/useEngineManagement'

import { setImportModelStageAtom } from '@/hooks/useImportModel'

import {
  getLogoEngine,
  getTitleByEngine,
  priorityEngine,
} from '@/utils/modelEngine'

import MyModelList from './MyModelList'

import {
  downloadedModelsAtom,
  showEngineListModelAtom,
} from '@/helpers/atoms/Model.atom'
import { showScrollBarAtom } from '@/helpers/atoms/Setting.atom'

const MyModels = () => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const { onDropModels } = useDropModelBinaries()
  const [searchText, setSearchText] = useState('')
  const [showEngineListModel, setShowEngineListModel] = useAtom(
    showEngineListModelAtom
  )
  const showScrollBar = useAtomValue(showScrollBarAtom)

  const { engines } = useGetEngines()

  const isLocalEngine = useCallback(
    (engine: string) =>
      Object.values(engines ?? {})
        .flat()
        .find((e) => e.name === engine)?.type === 'local' || false,
    [engines]
  )

  const isConfigured = useCallback(
    (engine: string) =>
      (Object.values(engines ?? {})
        .flat()
        .find((e) => e.engine === engine)?.api_key?.length ?? 0) > 0,
    [engines]
  )

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

  const findByEngine = filteredDownloadedModels.map((x) => {
    // Legacy engine support - they will be grouped under Cortex LlamaCPP
    if (x.engine === InferenceEngine.nitro)
      return InferenceEngine.cortex_llamacpp
    return x.engine
  })

  const groupByEngine = [...new Set(findByEngine)].sort((a, b) => {
    const aPriority = priorityEngine.indexOf(a)
    const bPriority = priorityEngine.indexOf(b)
    if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority
    if (aPriority !== -1) return -1
    if (bPriority !== -1) return 1
    return 0
  })

  const getEngineStatusReady: InferenceEngine[] = Object.entries(engines ?? {})
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ?.filter(([_, value]) => (value?.[0]?.api_key?.length ?? 0) > 0)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(([key, _]) => key as InferenceEngine)

  useEffect(() => {
    setShowEngineListModel((prev) => [
      ...prev,
      ...(getEngineStatusReady as InferenceEngine[]),
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setShowEngineListModel, engines])

  return (
    <div {...getRootProps()} className="h-full w-full">
      <ScrollArea
        type={showScrollBar ? 'always' : 'scroll'}
        className="h-full w-full"
      >
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
            {!groupByEngine.length ? (
              <div className="mt-8">
                <BlankState title="No search results found" />
              </div>
            ) : (
              groupByEngine.map((engine, i) => {
                const engineLogo = getLogoEngine(engine as InferenceEngine)
                const showModel = showEngineListModel.includes(engine)
                const onClickChevron = () => {
                  if (showModel) {
                    setShowEngineListModel((prev) =>
                      prev.filter((item) => item !== engine)
                    )
                  } else {
                    setShowEngineListModel((prev) => [...prev, engine])
                  }
                }

                return (
                  <div className="my-6" key={i}>
                    <div className="flex flex-row items-center justify-between gap-2">
                      <div
                        className="mb-1 mt-3 flex cursor-pointer items-center gap-2"
                        onClick={onClickChevron}
                      >
                        {engineLogo && (
                          <Image
                            className="h-6 w-6 flex-shrink-0"
                            width={48}
                            height={48}
                            src={engineLogo}
                            alt="logo"
                          />
                        )}
                        <h6 className="font-medium text-[hsla(var(--text-secondary))]">
                          {getTitleByEngine(engine)}
                        </h6>
                      </div>
                      <div className="flex gap-1">
                        {!isLocalEngine(engine) && (
                          <SetupRemoteModel
                            engine={engine}
                            isConfigured={isConfigured(engine)}
                          />
                        )}
                        {!showModel ? (
                          <Button theme="icon" onClick={onClickChevron}>
                            <ChevronDownIcon
                              size={14}
                              className="text-[hsla(var(--text-secondary))]"
                            />
                          </Button>
                        ) : (
                          <Button theme="icon" onClick={onClickChevron}>
                            <ChevronUpIcon
                              size={14}
                              className="text-[hsla(var(--text-secondary))]"
                            />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2">
                      {filteredDownloadedModels
                        ? filteredDownloadedModels
                            .filter(
                              (x) =>
                                x.engine === engine ||
                                (x.engine === InferenceEngine.nitro &&
                                  engine === InferenceEngine.cortex_llamacpp)
                            )
                            .map((model) => {
                              if (!showModel) return null
                              return (
                                <MyModelList key={model.id} model={model} />
                              )
                            })
                        : null}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

export default MyModels
