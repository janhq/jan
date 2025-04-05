/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import {
  DownloadEvent,
  EngineEvent,
  events,
  InferenceEngine,
} from '@janhq/core'
import { Button, ScrollArea, Badge, Select, Progress } from '@janhq/joi'

import { useAtom, useAtomValue } from 'jotai'
import { twMerge } from 'tailwind-merge'

import { useActiveModel } from '@/hooks/useActiveModel'
import {
  useGetDefaultEngineVariant,
  useGetInstalledEngines,
  useGetLatestReleasedEngine,
  setDefaultEngineVariant,
  installEngine,
  updateEngine,
  useGetReleasedEnginesByVersion,
} from '@/hooks/useEngineManagement'

import { formatDownloadPercentage } from '@/utils/converter'

import ExtensionSetting from '../ExtensionSetting'

import DeleteEngineVariant from './DeleteEngineVariant'

import {
  LocalEngineDefaultVariantAtom,
  RecommendEngineVariantAtom,
} from '@/helpers/atoms/App.atom'
import { showScrollBarAtom } from '@/helpers/atoms/Setting.atom'
const os = () => {
  switch (PLATFORM) {
    case 'win32':
      return 'windows'
    case 'linux':
      return 'linux'

    default:
      return 'mac'
  }
}

const LocalEngineSettings = ({ engine }: { engine: InferenceEngine }) => {
  const { installedEngines, mutate: mutateInstalledEngines } =
    useGetInstalledEngines(engine)
  const { defaultEngineVariant, mutate: mutateDefaultEngineVariant } =
    useGetDefaultEngineVariant(engine)
  const { latestReleasedEngine } = useGetLatestReleasedEngine(engine, os())
  const { releasedEnginesByVersion } = useGetReleasedEnginesByVersion(
    engine,
    defaultEngineVariant?.version as string,
    os()
  )
  const showScrollBar = useAtomValue(showScrollBarAtom)
  const [installingEngines, setInstallingEngines] = useState<
    Map<string, number>
  >(new Map())
  const { stopModel } = useActiveModel()

  const [recommendEngineVariant, setRecommendEngineVariant] = useAtom(
    RecommendEngineVariantAtom
  )

  const isEngineUpdated = useMemo(() => {
    if (!latestReleasedEngine || !defaultEngineVariant) return false
    const latestVariant = latestReleasedEngine.find((item) =>
      item.name.includes(defaultEngineVariant.variant)
    )
    if (!latestVariant) return false
    const latestVersion = latestVariant.name
      .replace(defaultEngineVariant.variant, '')
      .replaceAll('-', '')
    const currentVersion = defaultEngineVariant.version.replace(/^v/, '')
    return latestVersion <= currentVersion
  }, [latestReleasedEngine, defaultEngineVariant])

  const availableVariants = useMemo(
    () =>
      latestReleasedEngine?.map((e) =>
        e.name.replace(
          `${defaultEngineVariant?.version.replace(/^v/, '') as string}-`,
          ''
        )
      ),
    [latestReleasedEngine, defaultEngineVariant]
  )
  const options =
    installedEngines &&
    installedEngines
      .filter((x: any) => x.version === defaultEngineVariant?.version)
      .map((x: any) => ({
        name: x.name,
        value: x.name,
        recommend: recommendEngineVariant === x.name,
      }))

  const installedEngineByVersion = installedEngines?.filter(
    (x: any) => x.version === defaultEngineVariant?.version
  )

  const [selectedVariants, setSelectedVariants] = useAtom(
    LocalEngineDefaultVariantAtom
  )

  const selectedVariant = useMemo(
    () =>
      options?.map((e) => e.value).includes(selectedVariants)
        ? selectedVariants
        : undefined,
    [selectedVariants, options]
  )

  useEffect(() => {
    if (defaultEngineVariant?.variant) {
      setSelectedVariants(defaultEngineVariant.variant || '')
    }
    if (!recommendEngineVariant.length) {
      setRecommendEngineVariant(defaultEngineVariant?.variant || '')
    }
  }, [defaultEngineVariant, setSelectedVariants, setRecommendEngineVariant])

  const handleEngineUpdate = useCallback(
    async (event: { id: string; type: DownloadEvent; percent: number }) => {
      await stopModel().catch(console.info)
      mutateInstalledEngines()
      mutateDefaultEngineVariant()
      // Backward compatible support - cortex.cpp returns full variant file name
      const variant: string | undefined = event.id.includes('.tar.gz')
        ? availableVariants?.find((e) => event.id.includes(`${e}.tar.gz`))
        : availableVariants?.find((e) => event.id.includes(e))

      if (!variant) {
        console.error(
          'Variant not found for event.id:',
          event.id,
          availableVariants
        )
        return
      }

      // Clone the existing Map to ensure immutability
      setInstallingEngines((prev) => {
        const updated = new Map(prev)
        if (
          event.type === DownloadEvent.onFileDownloadError ||
          event.type === DownloadEvent.onFileDownloadStopped ||
          event.type === DownloadEvent.onFileDownloadSuccess
        ) {
          // Remove the variant from the Map if download stops/errors/succeeds
          updated.delete(variant)
        } else {
          // Update the variant with the new percentage
          updated.set(variant, event.percent)
        }
        return updated
      })
    },
    [
      stopModel,
      mutateDefaultEngineVariant,
      mutateInstalledEngines,
      setInstallingEngines,
      availableVariants,
    ]
  )

  useEffect(() => {
    events.on(EngineEvent.OnEngineUpdate, handleEngineUpdate)
    return () => {
      events.off(EngineEvent.OnEngineUpdate, handleEngineUpdate)
    }
  }, [handleEngineUpdate])

  const handleChangeVariant = async (e: string) => {
    await stopModel().catch(console.info)
    setSelectedVariants(e)
    setDefaultEngineVariant(engine, {
      variant: e,
      version: String(defaultEngineVariant?.version),
    })
  }

  return (
    <ScrollArea
      type={showScrollBar ? 'always' : 'scroll'}
      className="h-full w-full"
    >
      <div className="block w-full px-4">
        <div className="mb-3 mt-4 border-b border-[hsla(var(--app-border))] pb-4">
          <div className="flex w-full flex-col items-start justify-between sm:flex-row">
            <div className="w-full flex-shrink-0 space-y-1.5">
              <div className="flex items-center justify-between gap-x-2">
                <div>
                  <h6 className="line-clamp-1 font-semibold">Engine Version</h6>
                </div>
                <div className="flex items-center gap-x-3">
                  <Badge variant="outline" theme="secondary">
                    {defaultEngineVariant?.version}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="block w-full px-4">
        <div className="mb-3 mt-4 border-b border-[hsla(var(--app-border))] pb-4">
          <div className="flex w-full flex-col items-start justify-between sm:flex-row">
            <div className="w-full flex-shrink-0 space-y-1.5">
              <div className="flex items-center justify-between gap-x-2">
                <div>
                  <h6 className="line-clamp-1 font-semibold">Check Updates</h6>
                </div>
                <div className="flex items-center gap-x-3">
                  <Button
                    disabled={isEngineUpdated}
                    onClick={() => {
                      updateEngine(engine)
                    }}
                  >
                    {!isEngineUpdated ? 'Update now' : 'Updated'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="block w-full px-4">
        <div className="mb-3 mt-4 border-b border-[hsla(var(--app-border))] pb-4">
          <div className="flex w-full flex-col items-start justify-between sm:flex-row">
            <div className="w-full flex-shrink-0 space-y-1.5">
              <div className="flex items-center justify-between gap-x-4">
                <div>
                  <h6 className="line-clamp-1 font-semibold">
                    {engine} Backend
                  </h6>
                  <div className="mt-2 w-full font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
                    <p>
                      Choose the default variant that best suited for your
                      hardware. See&nbsp;
                      <a
                        href="https://jan.ai/docs/local-engines/llama-cpp"
                        className="cursor-pointer text-blue-600 dark:text-blue-400"
                        target="_blank"
                      >
                        our guides.
                      </a>
                    </p>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-x-3">
                  <div className="flex w-full min-w-[180px]">
                    <Select
                      value={selectedVariant}
                      placeholder="Select variant"
                      onValueChange={(e) => handleChangeVariant(e)}
                      options={options}
                      block
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="block w-full px-4">
        <div className="mb-3 mt-4 pb-4">
          <div className="flex w-full flex-col items-start justify-between sm:flex-row">
            <div className="w-full flex-shrink-0 ">
              <div className="flex items-center justify-between gap-x-2">
                <div>
                  <h6 className="mb-2 line-clamp-1 font-semibold">Backends</h6>
                </div>
              </div>

              <div>
                {releasedEnginesByVersion &&
                  releasedEnginesByVersion
                    ?.filter((item) => {
                      return !item.name.startsWith('cuda-')
                    })
                    .map((item, i) => {
                      return (
                        <div
                          key={i}
                          className={twMerge(
                            'border border-b-0 border-[hsla(var(--app-border))] bg-[hsla(var(--tertiary-bg))] p-4 first:rounded-t-lg last:rounded-b-lg last:border-b',
                            releasedEnginesByVersion?.length === 1 &&
                              'rounded-lg'
                          )}
                        >
                          <div className="flex flex-col items-start justify-start gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex w-full gap-x-8">
                              <div className="flex h-full w-full items-center justify-between gap-2">
                                <h6
                                  className={twMerge(
                                    'font-medium lg:line-clamp-1 lg:min-w-[280px] lg:max-w-[280px]',
                                    'max-w-none text-[hsla(var(--text-secondary))]'
                                  )}
                                >
                                  {item.name}
                                </h6>

                                {installedEngineByVersion?.some(
                                  (x) => x.name === item.name
                                ) ? (
                                  <DeleteEngineVariant
                                    variant={item}
                                    engine={engine}
                                  />
                                ) : (
                                  <>
                                    {installingEngines.has(item.name) ? (
                                      <Button variant="soft">
                                        <div className="flex items-center space-x-2">
                                          <Progress
                                            className="inline-block h-2 w-[80px]"
                                            value={
                                              formatDownloadPercentage(
                                                installingEngines.get(
                                                  item.name
                                                ) ?? 0,
                                                {
                                                  hidePercentage: true,
                                                }
                                              ) as number
                                            }
                                          />
                                          <span className="tabular-nums">
                                            {formatDownloadPercentage(
                                              installingEngines.get(
                                                item.name
                                              ) ?? 0
                                            )}
                                          </span>
                                        </div>
                                      </Button>
                                    ) : (
                                      <Button
                                        variant="soft"
                                        onClick={() => {
                                          setInstallingEngines((prev) => {
                                            const updated = new Map(prev)
                                            updated.set(item.name, 0)
                                            return updated
                                          })
                                          installEngine(engine, {
                                            variant: item.name,
                                            version: String(
                                              defaultEngineVariant?.version
                                            ),
                                          }).then(() => {
                                            if (selectedVariants === '') {
                                              setSelectedVariants(item.name)
                                            }
                                          })
                                        }}
                                      >
                                        Download
                                      </Button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
              </div>
            </div>
          </div>
        </div>
        <div className="border-b border-[hsla(var(--app-border))]" />
        <div className="flex w-full border-b border-[hsla(var(--app-border))]">
          {/* TODO: Pull settings from engine when it's supported */}
          <ExtensionSetting extensionName="@janhq/inference-cortex-extension" />
        </div>
      </div>
    </ScrollArea>
  )
}

export default LocalEngineSettings
