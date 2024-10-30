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
import { setImportModelStageAtom } from '@/hooks/useImportModel'

import {
  getLogoEngine,
  getTitleByEngine,
  isLocalEngine,
  priorityEngine,
} from '@/utils/modelEngine'

import MyModelList from './MyModelList'

import { extensionManager } from '@/extension'
import {
  downloadedModelsAtom,
  showEngineListModelAtom,
} from '@/helpers/atoms/Model.atom'

const MyModels = () => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const { onDropModels } = useDropModelBinaries()
  const [searchText, setSearchText] = useState('')
  const [showEngineListModel, setShowEngineListModel] = useAtom(
    showEngineListModelAtom
  )
  const [extensionHasSettings, setExtensionHasSettings] = useState<
    { name?: string; setting: string; apiKey: string; provider: string }[]
  >([])

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

  useEffect(() => {
    const getAllSettings = async () => {
      const extensionsMenu: {
        name?: string
        setting: string
        apiKey: string
        provider: string
      }[] = []
      const extensions = extensionManager.getAll()

      for (const extension of extensions) {
        if (typeof extension.getSettings === 'function') {
          const settings = await extension.getSettings()

          if (
            (settings && settings.length > 0) ||
            (await extension.installationState()) !== 'NotRequired'
          ) {
            extensionsMenu.push({
              name: extension.productName,
              setting: extension.name,
              apiKey:
                'apiKey' in extension && typeof extension.apiKey === 'string'
                  ? extension.apiKey
                  : '',
              provider:
                'provider' in extension &&
                typeof extension.provider === 'string'
                  ? extension.provider
                  : '',
            })
          }
        }
      }
      setExtensionHasSettings(extensionsMenu)
    }
    getAllSettings()
  }, [])

  const findByEngine = filteredDownloadedModels.map((x) => {
    // Legacy engine support - they will be grouped under Cortex LlamaCPP
    if (x.engine === InferenceEngine.nitro)
      return InferenceEngine.cortex_llamacpp
    return x.engine
  })
  const groupByEngine = findByEngine
    .filter(function (item, index) {
      if (findByEngine.indexOf(item) === index) return item
    })
    .sort((a, b) => {
      if (priorityEngine.includes(a) && priorityEngine.includes(b)) {
        return priorityEngine.indexOf(a) - priorityEngine.indexOf(b)
      } else if (priorityEngine.includes(a)) {
        return -1
      } else if (priorityEngine.includes(b)) {
        return 1
      } else {
        return 0 // Leave the rest in their original order
      }
    })

  const getEngineStatusReady: InferenceEngine[] = extensionHasSettings
    ?.filter((e) => e.apiKey.length > 0)
    .map((x) => x.provider as InferenceEngine)

  useEffect(() => {
    setShowEngineListModel((prev) => [
      ...prev,
      ...(getEngineStatusReady as InferenceEngine[]),
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setShowEngineListModel, extensionHasSettings])

  return (
    <div {...getRootProps()} className="h-full w-full">
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
                    <div className="flex flex-col items-start justify-start gap-2 sm:flex-row sm:items-center sm:justify-between">
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
                          <SetupRemoteModel engine={engine} />
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
                            .filter((x) => x.engine === engine)
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
