import React, { Fragment, useMemo, useState } from 'react'

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

import { useGetEngines } from '@/hooks/useEngineManagement'

import {
  useGetFeaturedSources,
  useGetModelSources,
} from '@/hooks/useModelSource'

import { formatDownloadPercentage, toGigabytes } from '@/utils/converter'

import { getLogoEngine, getTitleByEngine } from '@/utils/modelEngine'

import { extractModelName } from '@/utils/modelSource'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { getDownloadingModelAtom } from '@/helpers/atoms/Model.atom'
import {
  selectedSettingAtom,
  showScrollBarAtom,
} from '@/helpers/atoms/Setting.atom'

type Props = {
  isShowStarterScreen?: boolean
}

function OnboardingScreen({ isShowStarterScreen }: Props) {
  const [searchValue, setSearchValue] = useState('')
  const [isOpen, setIsOpen] = useState(Boolean(searchValue.length))
  const downloadingModels = useAtomValue(getDownloadingModelAtom)
  const { downloadModel } = useDownloadModel()
  const downloadStates = useAtomValue(modelDownloadStateAtom)
  const setSelectedSetting = useSetAtom(selectedSettingAtom)
  const { engines } = useGetEngines()
  const showScrollBar = useAtomValue(showScrollBarAtom)

  const { sources } = useGetModelSources()
  const setMainViewState = useSetAtom(mainViewStateAtom)

  const { sources: featuredModels } = useGetFeaturedSources()

  const filteredModels = useMemo(
    () =>
      sources?.filter((x) =>
        x.id.toLowerCase().includes(searchValue.toLowerCase())
      ),
    [sources, searchValue]
  )

  const itemsPerRow = 5

  const getRows = (array: string[], itemsPerRow: number) => {
    const rows = []
    for (let i = 0; i < array.length; i += itemsPerRow) {
      rows.push(array.slice(i, i + itemsPerRow))
    }
    return rows
  }

  const cloudProviders = getRows(
    Object.keys(engines ?? {})
      .filter((e) => engines?.[e as InferenceEngine]?.[0]?.type === 'remote')
      .sort((a, b) => a.localeCompare(b)),
    itemsPerRow
  )

  const refDropdown = useClickOutside(() => setIsOpen(false))

  const [visibleRows, setVisibleRows] = useState(1)

  return (
    <CenterPanelContainer isShowStarterScreen={isShowStarterScreen}>
      <ScrollArea
        type={showScrollBar ? 'always' : 'scroll'}
        className="flex h-full w-full items-center"
        data-testid="onboard-screen"
      >
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
                    {!featuredModels?.length ? (
                      <div className="p-3 text-center">
                        <p className="line-clamp-1 text-[hsla(var(--text-secondary))]">
                          No Result Found
                        </p>
                      </div>
                    ) : (
                      filteredModels?.map((model) => {
                        const isDownloading = downloadingModels.some(
                          (md) => md === (model.models[0]?.id ?? model.id)
                        )
                        return (
                          <div
                            key={model.id}
                            className="flex items-center justify-between gap-4 px-3 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
                          >
                            <div className="flex items-center gap-2">
                              <p
                                className={'line-clamp-1 capitalize'}
                                title={extractModelName(model.id)}
                              >
                                {extractModelName(model.id)}
                              </p>
                              <ModelLabel
                                size={model.models[0]?.size}
                                compact
                              />
                            </div>
                            <div className="flex items-center gap-2 text-[hsla(var(--text-tertiary))]">
                              <span className="font-medium">
                                {toGigabytes(model.models[0]?.size)}
                              </span>
                              {!isDownloading ? (
                                <DownloadCloudIcon
                                  size={18}
                                  className="cursor-pointer text-[hsla(var(--app-link))]"
                                  onClick={() =>
                                    downloadModel(
                                      model.models[0]?.id ?? model.id
                                    )
                                  }
                                />
                              ) : (
                                Object.values(downloadStates)
                                  .filter(
                                    (x) => x.modelId === model.models[0]?.id
                                  )
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

                {featuredModels?.map((featModel) => {
                  const isDownloading = downloadingModels.some(
                    (md) => md === (featModel.models[0]?.id ?? featModel.id)
                  )
                  return (
                    <div
                      key={featModel.id}
                      className="my-2 flex items-start justify-between gap-2 border-b border-[hsla(var(--app-border))] pb-4 pt-1 last:border-none"
                    >
                      <div className="w-full text-left">
                        <h6 className="mt-1.5 font-medium capitalize">
                          {extractModelName(featModel.id)}
                        </h6>
                      </div>

                      {isDownloading ? (
                        <div className="flex w-full flex-col items-end gap-2">
                          {Object.values(downloadStates)
                            .filter(
                              (x) => x.modelId === featModel.models[0]?.id
                            )
                            .map((item, i) => (
                              <div
                                className="mt-1.5 flex w-full items-center gap-2"
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
                          <span className="text-[hsla(var(--text-secondary))]">
                            {toGigabytes(featModel.models[0]?.size)}
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-end justify-end gap-2">
                          <Button
                            theme="ghost"
                            className="!bg-[hsla(var(--secondary-bg))]"
                            onClick={() =>
                              downloadModel(featModel.models[0]?.id)
                            }
                          >
                            Download
                          </Button>
                          <span className="text-[hsla(var(--text-secondary))]">
                            {toGigabytes(featModel.models[0]?.size)}
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
                  {cloudProviders.slice(0, visibleRows).map((row, rowIndex) => {
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
                                  remoteEngine as InferenceEngine
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
                {visibleRows < cloudProviders.length && (
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

export default OnboardingScreen
