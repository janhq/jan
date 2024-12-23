/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useState } from 'react'

import { EngineEvent, events, InferenceEngine } from '@janhq/core'
import { Button, ScrollArea, Badge, Select } from '@janhq/joi'

import { Trash2Icon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import {
  useGetDefaultEngineVariant,
  useGetInstalledEngines,
  useGetLatestReleasedEngine,
  setDefaultEngineVariant,
  installEngine,
  updateEngine,
  uninstallEngine,
  useGetReleasedEnginesByVersion,
} from '@/hooks/useEngineManagement'

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

const EngineSettings = ({ engine }: { engine: InferenceEngine }) => {
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

  const isEngineUpdated =
    latestReleasedEngine &&
    latestReleasedEngine.every((item) =>
      item.name.includes(
        defaultEngineVariant?.version.replace(/^v/, '') as string
      )
    )

  const options =
    installedEngines &&
    installedEngines
      .filter((x: any) => x.version === defaultEngineVariant?.version)
      .map((x: any) => ({
        name: x.name,
        value: x.name,
      }))

  const installedEngineByVersion = installedEngines?.filter(
    (x: any) => x.version === defaultEngineVariant?.version
  )

  const [selectedVariants, setSelectedVariants] = useState(
    defaultEngineVariant?.variant
  )

  useEffect(() => {
    if (defaultEngineVariant?.variant) {
      setSelectedVariants(defaultEngineVariant.variant || '')
    }
  }, [defaultEngineVariant])

  const handleEngineUpdate = useCallback(() => {
    mutateInstalledEngines()
    mutateDefaultEngineVariant()
  }, [mutateDefaultEngineVariant, mutateInstalledEngines])

  useEffect(() => {
    events.on(EngineEvent.OnEngineUpdate, handleEngineUpdate)
    return () => {
      events.off(EngineEvent.OnEngineUpdate, handleEngineUpdate)
    }
  }, [handleEngineUpdate])

  const handleChangeVariant = (e: string) => {
    setSelectedVariants(e)
    setDefaultEngineVariant(engine, {
      variant: e,
      version: String(defaultEngineVariant?.version),
    })
  }

  return (
    <ScrollArea className="h-full w-full">
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
                      hardware. See more information here.
                    </p>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-x-3">
                  <div className="flex w-full min-w-[180px]">
                    <Select
                      value={selectedVariants}
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
                  releasedEnginesByVersion?.map((item, i) => {
                    return (
                      <div
                        key={i}
                        className={twMerge(
                          'border border-b-0 border-[hsla(var(--app-border))] bg-[hsla(var(--tertiary-bg))] p-4 first:rounded-t-lg last:rounded-b-lg last:border-b',
                          releasedEnginesByVersion?.length === 1 && 'rounded-lg'
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
                                <Button
                                  theme="icon"
                                  variant="outline"
                                  onClick={() => {
                                    uninstallEngine(engine, {
                                      variant: item.name,
                                      version: String(
                                        defaultEngineVariant?.version
                                      ),
                                    })
                                    if (selectedVariants === item.name) {
                                      setSelectedVariants('')
                                    }
                                    mutateInstalledEngines()
                                  }}
                                >
                                  <Trash2Icon
                                    size={14}
                                    className="text-[hsla(var(--text-secondary))]"
                                  />
                                </Button>
                              ) : (
                                <Button
                                  variant="soft"
                                  onClick={() => {
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
      </div>
    </ScrollArea>
  )
}

export default EngineSettings
