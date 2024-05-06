import { useCallback, useEffect, useMemo, useState } from 'react'

import { useDropzone } from 'react-dropzone'

import { InferenceEngine } from '@janhq/core'

import { Button, ScrollArea } from '@janhq/joi'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { PlusIcon, UploadCloudIcon, UploadIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import ModelSearch from '@/containers/ModelSearch'

import useDropModelBinaries from '@/hooks/useDropModelBinaries'
import { setImportModelStageAtom } from '@/hooks/useImportModel'

import MyModelList from './MyModelList'

import { extensionManager } from '@/extension'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const MyModels = () => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const { onDropModels } = useDropModelBinaries()
  const [searchText, setSearchText] = useState('')

  const [extensionHasSettings, setExtensionHasSettings] = useState<
    { name?: string; setting: string }[]
  >([])

  console.log(extensionHasSettings)

  useEffect(() => {
    const getAllSettings = async () => {
      const extensionsMenu: { name?: string; setting: string }[] = []
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
            })
          }
        }
      }
      setExtensionHasSettings(extensionsMenu)
    }
    getAllSettings()
  }, [])

  const filteredDownloadedModels = useMemo(
    () =>
      downloadedModels
        .filter((e) =>
          e.name.toLowerCase().includes(searchText.toLowerCase().trim())
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [downloadedModels, searchText]
  )

  const setSelectedSetting = useSetAtom(selectedSettingAtom)

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

  const onSetupItemClick = (setting: InferenceEngine) => {
    console.log(setting)
    setSelectedSetting(
      extensionHasSettings.filter((x) =>
        x.setting.toLowerCase().includes(setting)
      )[0]?.setting
    )
  }

  return (
    <div {...getRootProps()} className="w-full">
      <ScrollArea className="h-full w-full">
        {/* TODO: @faisal make sure this feature */}
        {isDragActive && (
          <div className="absolute z-50 mx-auto h-full w-full bg-[hsla(var(--app-bg))]/50 p-8 backdrop-blur-lg">
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

        <div className="m-4 rounded-xl">
          <div className="flex flex-col justify-between gap-2 sm:flex-row">
            <div className="w-full sm:w-[300px]">
              <ModelSearch onSearchLocal={onSearchChange} />
            </div>
            <Button
              variant="outline"
              theme="ghost"
              size="small"
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
                  <h6 className="text-base font-semibold">cortex.cpp</h6>
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

            <div className="my-6">
              <div className="flex flex-col items-start justify-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h6 className="text-base font-semibold">Cohere</h6>
                <Button
                  size="small"
                  variant="soft"
                  onClick={() => onSetupItemClick(InferenceEngine.cohere)}
                >
                  <PlusIcon
                    size={16}
                    className="text-hsla(var(--app-text-sencondary)) mr-1.5"
                  />
                  <span>Set Up</span>
                </Button>
              </div>
              <div className="mt-2">
                {filteredDownloadedModels
                  ? filteredDownloadedModels
                      .filter((x) => x.engine === InferenceEngine.cohere)
                      .map((model) => {
                        return <MyModelList key={model.id} model={model} />
                      })
                  : null}
              </div>
            </div>

            {filteredDownloadedModels.filter(
              (x) => x.engine === InferenceEngine.groq
            ).length !== 0 && (
              <div className="my-6">
                <div className="flex flex-col items-start justify-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h6 className="text-base font-semibold">Groq</h6>
                  <Button
                    size="small"
                    variant="soft"
                    onClick={() => onSetupItemClick(InferenceEngine.groq)}
                  >
                    <PlusIcon
                      size={16}
                      className="text-hsla(var(--app-text-sencondary)) mr-1.5"
                    />
                    <span>Set Up</span>
                  </Button>
                </div>
                <div className="mt-2">
                  {filteredDownloadedModels
                    ? filteredDownloadedModels
                        .filter((x) => x.engine === InferenceEngine.groq)
                        .map((model) => {
                          return <MyModelList key={model.id} model={model} />
                        })
                    : null}
                </div>
              </div>
            )}

            {filteredDownloadedModels.filter(
              (x) => x.engine === InferenceEngine.openai
            ).length !== 0 && (
              <div className="my-6">
                <div className="flex flex-col items-start justify-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h6 className="text-base font-semibold">Open AI</h6>
                  <Button
                    size="small"
                    variant="soft"
                    onClick={() => onSetupItemClick(InferenceEngine.openai)}
                  >
                    <PlusIcon
                      size={16}
                      className="text-hsla(var(--app-text-sencondary)) mr-1.5"
                    />
                    <span>Set Up</span>
                  </Button>
                </div>
                <div className="mt-2">
                  {filteredDownloadedModels
                    ? filteredDownloadedModels
                        .filter((x) => x.engine === InferenceEngine.openai)
                        .map((model) => {
                          return <MyModelList key={model.id} model={model} />
                        })
                    : null}
                </div>
              </div>
            )}

            {filteredDownloadedModels.filter(
              (x) => x.engine === InferenceEngine.triton_trtllm
            ).length !== 0 && (
              <div className="my-6">
                <div className="flex flex-col items-start justify-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h6 className="text-base font-semibold">Triton trtllm</h6>
                  <Button
                    size="small"
                    variant="soft"
                    onClick={() =>
                      onSetupItemClick(InferenceEngine.triton_trtllm)
                    }
                  >
                    <PlusIcon
                      size={16}
                      className="text-hsla(var(--app-text-sencondary)) mr-1.5"
                    />
                    <span>Set Up</span>
                  </Button>
                </div>
                <div className="mt-2">
                  {filteredDownloadedModels
                    ? filteredDownloadedModels
                        .filter(
                          (x) => x.engine === InferenceEngine.triton_trtllm
                        )
                        .map((model) => {
                          return <MyModelList key={model.id} model={model} />
                        })
                    : null}
                </div>
              </div>
            )}

            {filteredDownloadedModels.filter(
              (x) => x.engine === InferenceEngine.nitro_tensorrt_llm
            ).length !== 0 && (
              <div className="my-6">
                <div className="flex flex-col items-start justify-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h6 className="text-base font-semibold">
                    Nitro Tensorrt llm
                  </h6>
                  <Button
                    size="small"
                    variant="soft"
                    onClick={() =>
                      onSetupItemClick(InferenceEngine.nitro_tensorrt_llm)
                    }
                  >
                    <PlusIcon
                      size={16}
                      className="text-hsla(var(--app-text-sencondary)) mr-1.5"
                    />
                    <span>Set Up</span>
                  </Button>
                </div>
                <div className="mt-2">
                  {filteredDownloadedModels
                    ? filteredDownloadedModels
                        .filter(
                          (x) => x.engine === InferenceEngine.nitro_tensorrt_llm
                        )
                        .map((model) => {
                          return <MyModelList key={model.id} model={model} />
                        })
                    : null}
                </div>
              </div>
            )}
          </div>

          {/* <table className="relative w-full px-8">
          <thead className="w-full border-b border-[hsla(var(--app-border))] bg-secondary">
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
        </table> */}
        </div>
      </ScrollArea>
    </div>
  )
}

export default MyModels
