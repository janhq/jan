import React, { Fragment, useState } from 'react'

import Image from 'next/image'

import { InferenceEngine } from '@janhq/core'
import { Button, Input, Progress, ScrollArea } from '@janhq/joi'
import { useClickOutside } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'
import { SearchIcon, DownloadCloudIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'
import CenterPanelContainer from '@/containers/CenterPanelContainer'

import ProgressCircle from '@/containers/Loader/ProgressCircle'

import ModelLabel from '@/containers/ModelLabel'

import { MainViewState } from '@/constants/screens'

import useDownloadModel from '@/hooks/useDownloadModel'

import { modelDownloadStateAtom } from '@/hooks/useDownloadState'

import { formatDownloadPercentage, toGibibytes } from '@/utils/converter'
import {
  getLogoEngine,
  getTitleByEngine,
  isLocalEngine,
} from '@/utils/modelEngine'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import {
  configuredModelsAtom,
  getDownloadingModelAtom,
} from '@/helpers/atoms/Model.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

type Props = {
  extensionHasSettings: {
    name?: string
    setting: string
    apiKey: string
    provider: string
  }[]
}

const OnDeviceStarterScreen = ({ extensionHasSettings }: Props) => {
  const [searchValue, setSearchValue] = useState('')
  const [isOpen, setIsOpen] = useState(Boolean(searchValue.length))
  const downloadingModels = useAtomValue(getDownloadingModelAtom)
  const { downloadModel } = useDownloadModel()
  const downloadStates = useAtomValue(modelDownloadStateAtom)
  const setSelectedSetting = useSetAtom(selectedSettingAtom)

  const configuredModels = useAtomValue(configuredModelsAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)

  const recommendModel = ['llama3.2-1b-instruct', 'llama3.2-3b-instruct']

  const featuredModel = configuredModels.filter((x) => {
    const manualRecommendModel = configuredModels.filter((x) =>
      recommendModel.includes(x.id)
    )

    if (manualRecommendModel.length === 2) {
      return x.id === recommendModel[0] || x.id === recommendModel[1]
    } else {
      return (
        x.metadata?.tags?.includes('Featured') && x.metadata?.size < 5000000000
      )
    }
  })

  const remoteModel = configuredModels.filter((x) => !isLocalEngine(x.engine))

  const filteredModels = configuredModels.filter((model) => {
    return (
      isLocalEngine(model.engine) &&
      model.name.toLowerCase().includes(searchValue.toLowerCase())
    )
  })

  const remoteModelEngine = remoteModel.map((x) => x.engine)

  const groupByEngine = remoteModelEngine.filter(function (item, index) {
    if (remoteModelEngine.indexOf(item) === index) return item
  })

  const itemsPerRow = 5

  const getRows = (array: string[], itemsPerRow: number) => {
    const rows = []
    for (let i = 0; i < array.length; i += itemsPerRow) {
      rows.push(array.slice(i, i + itemsPerRow))
    }
    return rows
  }

  const rows = getRows(groupByEngine, itemsPerRow)

  const refDropdown = useClickOutside(() => setIsOpen(false))

  const [visibleRows, setVisibleRows] = useState(1)

  return (
    <CenterPanelContainer>
      <ScrollArea className="flex h-full w-full items-center">
        <div className="relative mt-4 flex h-full w-full flex-col items-center justify-center">
          <div className="mx-auto flex h-full w-3/4 flex-col items-center justify-center py-16 text-center">
            <LogoMark
              className="mx-auto mb-4 animate-wave"
              width={48}
              height={48}
            />
            <h1 className="text-base font-medium">Select a model to start</h1>
            <div className="mt-6 w-[320px] md:w-[400px]">
              <Fragment>
                <div className="relative" ref={refDropdown}>
                  <Input
                    value={searchValue}
                    onFocus={() => setIsOpen(true)}
                    onChange={(e) => {
                      setSearchValue(e.target.value)
                    }}
                    placeholder="Search..."
                    prefixIcon={<SearchIcon size={16} />}
                  />
                  <div
                    className={twMerge(
                      'absolute left-0 top-10 z-20 max-h-[240px] w-full overflow-x-auto rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))]',
                      !isOpen ? 'invisible' : 'visible'
                    )}
                  >
                    {!filteredModels.length ? (
                      <div className="p-3 text-center">
                        <p className="line-clamp-1 text-[hsla(var(--text-secondary))]">
                          No Result Found
                        </p>
                      </div>
                    ) : (
                      filteredModels.map((model) => {
                        const isDownloading = downloadingModels.some(
                          (md) => md === model.id
                        )
                        return (
                          <div
                            key={model.id}
                            className="flex items-center justify-between gap-4 px-3 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
                          >
                            <div className="flex items-center gap-2">
                              <p
                                className={twMerge('line-clamp-1')}
                                title={model.name}
                              >
                                {model.name}
                              </p>
                              <ModelLabel metadata={model.metadata} compact />
                            </div>
                            <div className="flex items-center gap-2 text-[hsla(var(--text-tertiary))]">
                              <span className="font-medium">
                                {toGibibytes(model.metadata?.size)}
                              </span>
                              {!isDownloading ? (
                                <DownloadCloudIcon
                                  size={18}
                                  className="cursor-pointer text-[hsla(var(--app-link))]"
                                  onClick={() =>
                                    downloadModel(
                                      model.sources[0].url,
                                      model.id
                                    )
                                  }
                                />
                              ) : (
                                Object.values(downloadStates)
                                  .filter((x) => x.modelId === model.id)
                                  .map((item) => (
                                    <ProgressCircle
                                      key={item.modelId}
                                      percentage={
                                        formatDownloadPercentage(
                                          item?.percent,
                                          {
                                            hidePercentage: true,
                                          }
                                        ) as number
                                      }
                                      size={100}
                                    />
                                  ))
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between">
                  <h2 className="text-[hsla(var(--text-secondary))]">
                    On-device Models
                  </h2>
                  <p
                    className="cursor-pointer text-sm text-[hsla(var(--text-secondary))]"
                    onClick={() => {
                      setMainViewState(MainViewState.Hub)
                    }}
                  >
                    See All
                  </p>
                </div>

                {featuredModel.slice(0, 2).map((featModel) => {
                  const isDownloading = downloadingModels.some(
                    (md) => md === featModel.id
                  )
                  return (
                    <div
                      key={featModel.id}
                      className="my-2 flex items-center justify-between gap-2 border-b border-[hsla(var(--app-border))] pb-4 pt-1 last:border-none"
                    >
                      <div className="w-full text-left">
                        <h6 className="font-medium">{featModel.name}</h6>
                      </div>

                      {isDownloading ? (
                        <div className="flex w-full items-center gap-2">
                          {Object.values(downloadStates)
                            .filter((x) => x.modelId === featModel.id)
                            .map((item, i) => (
                              <div
                                className="flex w-full items-center gap-2"
                                key={i}
                              >
                                <Progress
                                  className="w-full"
                                  value={
                                    formatDownloadPercentage(item?.percent, {
                                      hidePercentage: true,
                                    }) as number
                                  }
                                />
                                <div className="flex items-center justify-between gap-x-2">
                                  <div className="flex gap-x-2">
                                    <span className="font-medium text-[hsla(var(--primary-bg))]">
                                      {formatDownloadPercentage(item?.percent)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-end justify-end gap-2">
                          <Button
                            theme="ghost"
                            className="!bg-[hsla(var(--secondary-bg))]"
                            onClick={() =>
                              downloadModel(
                                featModel.sources[0].url,
                                featModel.id
                              )
                            }
                          >
                            Download
                          </Button>
                          <span className="text-[hsla(var(--text-secondary))]">
                            {toGibibytes(featModel.metadata?.size)}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}

                <div className="mb-2 mt-8 flex items-center justify-between">
                  <h2 className="text-[hsla(var(--text-secondary))]">
                    Cloud Models
                  </h2>
                </div>

                <div className="flex flex-col justify-center gap-6">
                  {rows.slice(0, visibleRows).map((row, rowIndex) => {
                    return (
                      <div
                        key={rowIndex}
                        className="my-2 flex items-center gap-4 md:gap-10"
                      >
                        {row.map((remoteEngine) => {
                          const engineLogo = getLogoEngine(
                            remoteEngine as InferenceEngine
                          )

                          return (
                            <div
                              className="flex cursor-pointer flex-col items-center justify-center gap-4"
                              key={remoteEngine}
                              onClick={() => {
                                setMainViewState(MainViewState.Settings)
                                setSelectedSetting(
                                  extensionHasSettings.find((x) =>
                                    x.name?.toLowerCase().includes(remoteEngine)
                                  )?.setting as string
                                )
                              }}
                            >
                              {engineLogo && (
                                <Image
                                  width={48}
                                  height={48}
                                  src={engineLogo}
                                  alt="Engine logo"
                                  className="h-10 w-10 flex-shrink-0"
                                />
                              )}

                              <p className="font-medium">
                                {getTitleByEngine(
                                  remoteEngine as InferenceEngine
                                )}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
                {visibleRows < rows.length && (
                  <button
                    onClick={() => setVisibleRows(visibleRows + 1)}
                    className="mt-4 text-[hsla(var(--text-secondary))]"
                  >
                    See More
                  </button>
                )}
              </Fragment>
            </div>
          </div>
        </div>
      </ScrollArea>
    </CenterPanelContainer>
  )
}

export default OnDeviceStarterScreen
