/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react/no-unescaped-entities */
/* eslint-disable @typescript-eslint/no-unused-vars */

import React, { useCallback, useRef, useState, useEffect } from 'react'

import {
  EngineConfig as OriginalEngineConfig,
  InferenceEngine,
  events,
  EngineEvent,
} from '@janhq/core'

interface EngineConfig extends OriginalEngineConfig {
  [key: string]: any
}

import { ScrollArea, Input, TextArea, Button } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'

import { set } from 'lodash'
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  RefreshCwIcon,
} from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import Spinner from '@/containers/Loader/Spinner'

import {
  updateEngine,
  useGetEngines,
  useRefreshModelList,
} from '@/hooks/useEngineManagement'

import { getTitleByEngine } from '@/utils/modelEngine'

import { getLogoEngine } from '@/utils/modelEngine'

import ModalAddModel from './ModalAddModel'
import ModalDeleteModel from './ModalDeleteModel'

import {
  downloadedModelsAtom,
  selectedModelAtom,
} from '@/helpers/atoms/Model.atom'
import { showScrollBarAtom } from '@/helpers/atoms/Setting.atom'
import { threadsAtom } from '@/helpers/atoms/Thread.atom'

const RemoteEngineSettings = ({
  engine: engineName,
}: {
  engine: InferenceEngine
}) => {
  const { engines, mutate } = useGetEngines()
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const [showApiKey, setShowApiKey] = useState(false)
  const remoteModels = downloadedModels.filter((e) => e.engine === engineName)
  const [isActiveAdvanceSetting, setisActiveAdvanceSetting] = useState(false)
  const setSelectedModel = useSetAtom(selectedModelAtom)
  const customEngineLogo = getLogoEngine(engineName)
  const threads = useAtomValue(threadsAtom)
  const { refreshingModels, refreshModels } = useRefreshModelList(engineName)
  const showScrollBar = useAtomValue(showScrollBarAtom)

  const engine =
    engines &&
    Object.entries(engines)
      .filter(([key]) => key === engineName)
      .flatMap(([_, engineArray]) => engineArray as EngineConfig)[0]

  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const handleChange = useCallback(
    (field: string, value: any) => {
      if (!engine) return

      setData((prevData) => {
        const updatedData = { ...prevData }
        set(updatedData, field, value)
        return updatedData
      })

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(async () => {
        const updatedEngine = { ...engine }
        set(updatedEngine, field, value)
        await updateEngine(engineName, updatedEngine)
        mutate()
        events.emit(EngineEvent.OnEngineUpdate, {})
      }, 300)
    },
    [engine, engineName, mutate]
  )

  const [data, setData] = useState({
    api_key: '',
    metadata: {
      header_template: '',
      get_models_url: '',
      transform_req: {
        chat_completions: {
          template: '',
          url: '',
        },
      },
      transform_resp: {
        chat_completions: {
          template: '',
        },
      },
    },
  })

  useEffect(() => {
    if (threads.length === 0) {
      setSelectedModel(remoteModels[0])
    }
    if (engine) {
      setData({
        api_key: engine.api_key || '',
        metadata: {
          header_template: engine.metadata?.header_template || '',
          get_models_url: engine.metadata?.get_models_url || '',
          transform_req: {
            chat_completions: {
              template:
                engine.metadata?.transform_req?.chat_completions?.template ||
                '',
              url: engine.metadata?.transform_req?.chat_completions?.url || '',
            },
          },
          transform_resp: {
            chat_completions: {
              template:
                engine.metadata?.transform_resp?.chat_completions?.template ||
                '',
            },
          },
        },
      })
    }
  }, [engine])

  if (!engine) return null

  return (
    <ScrollArea
      type={showScrollBar ? 'always' : 'scroll'}
      className="h-full w-full"
    >
      <div className="block w-full px-4">
        <div className="mb-3 mt-4 border-b border-[hsla(var(--app-border))] pb-4">
          <div className="flex w-full flex-col items-start justify-between sm:flex-row">
            <div className="w-full flex-shrink-0 space-y-1.5">
              <div className="flex items-start justify-between gap-x-2">
                <div className="w-full sm:w-3/4">
                  <h6 className="line-clamp-1 font-semibold">API Key</h6>
                  <p className="mt-1 text-[hsla(var(--text-secondary))]">
                    {!customEngineLogo ? (
                      <span>
                        Enter your authentication key to activate this
                        engine.{' '}
                      </span>
                    ) : (
                      <span>
                        Enter your authentication key to activate this engine.
                        {engine.engine && engine.url && (
                          <span>
                            &nbsp;Get your API key from{' '}
                            <a
                              target="_blank"
                              href={engine.url}
                              className="text-[hsla(var(--app-link))]"
                            >
                              {getTitleByEngine(engine.engine)}.
                            </a>
                          </span>
                        )}
                      </span>
                    )}
                  </p>
                </div>
                <div className="w-full">
                  <div className="relative">
                    {data?.api_key.length > 0 && (
                      <div className="absolute right-4 top-1/2 z-10 -translate-y-1/2">
                        <div
                          className="cursor-pointer"
                          onClick={() => setShowApiKey(!showApiKey)}
                        >
                          {showApiKey ? (
                            <EyeOff
                              size={14}
                              className="text-[hsla(var(--text-seconday))]"
                            />
                          ) : (
                            <Eye
                              size={14}
                              className="text-[hsla(var(--text-seconday))]"
                            />
                          )}
                        </div>
                      </div>
                    )}
                    <Input
                      placeholder="Enter API Key"
                      type={showApiKey ? 'text' : 'password'}
                      value={data?.api_key}
                      className="pr-10"
                      onChange={(e) => handleChange('api_key', e.target.value)}
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
              <div className="mb-4 flex items-center justify-between gap-x-2">
                <div>
                  <h6 className="mb-2 line-clamp-1 font-semibold">Model</h6>
                </div>
                <div className="flex gap-2">
                  <Button
                    theme={'ghost'}
                    variant={'outline'}
                    onClick={() => refreshModels(engineName)}
                  >
                    {refreshingModels ? (
                      <Spinner size={16} strokeWidth={2} className="mr-2" />
                    ) : (
                      <RefreshCwIcon size={16} className="mr-2" />
                    )}
                    Refresh
                  </Button>
                  <ModalAddModel engine={engineName} />
                </div>
              </div>

              <div>
                {remoteModels &&
                  remoteModels?.map((item, i) => {
                    return (
                      <div
                        key={i}
                        className={twMerge(
                          'border border-b-0 border-[hsla(var(--app-border))] bg-[hsla(var(--tertiary-bg))] p-4 first:rounded-t-lg last:rounded-b-lg last:border-b',
                          remoteModels?.length === 1 && 'rounded-lg'
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
                              <ModalDeleteModel model={item} />
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

      <div className="px-4 pb-4">
        <p
          className="flex cursor-pointer items-center text-sm font-medium text-[hsla(var(--text-secondary))]"
          onClick={() => setisActiveAdvanceSetting(!isActiveAdvanceSetting)}
        >
          <span>Advanced Settings</span>
          <span>
            {isActiveAdvanceSetting ? (
              <ChevronDown size={14} className="ml-1" />
            ) : (
              <ChevronRight size={14} className="ml-1" />
            )}
          </span>
        </p>
      </div>

      {isActiveAdvanceSetting && (
        <div>
          <div className="block w-full px-4">
            <div className="mb-3 mt-4 border-b border-[hsla(var(--app-border))] pb-4">
              <div className="flex w-full flex-col items-start justify-between sm:flex-row">
                <div className="w-full flex-shrink-0 space-y-1.5">
                  <div className="flex items-start justify-between gap-x-2">
                    <div className="w-full sm:w-3/4">
                      <h6 className="line-clamp-1 font-semibold">
                        Chat Completion URL
                      </h6>
                      <p className="mt-1 text-[hsla(var(--text-secondary))]">
                        Enter your chat completion URL.
                      </p>
                    </div>
                    <div className="w-full">
                      <Input
                        placeholder="Enter Chat Completion URL"
                        value={
                          data?.metadata.transform_req.chat_completions.url
                        }
                        onChange={(e) =>
                          handleChange(
                            'metadata.transform_req.chat_completions.url',
                            e.target.value
                          )
                        }
                      />
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
                  <div className="flex items-start justify-between gap-x-2">
                    <div className="w-full sm:w-3/4">
                      <h6 className="line-clamp-1 font-semibold">
                        Model List URL
                      </h6>
                      <p className="mt-1 text-[hsla(var(--text-secondary))]">
                        The endpoint URL to fetch available models.
                      </p>
                    </div>
                    <div className="w-full">
                      <Input
                        placeholder="Enter model list URL"
                        value={data?.metadata?.get_models_url}
                        onChange={(e) =>
                          handleChange(
                            'metadata.get_models_url',
                            e.target.value
                          )
                        }
                      />
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
                  <div className="flex items-start justify-between gap-x-2">
                    <div className="w-full sm:w-3/4">
                      <h6 className="line-clamp-1 font-semibold">
                        Request Headers Template
                      </h6>
                      <p className="mt-1 text-[hsla(var(--text-secondary))]">
                        HTTP headers template required for API authentication
                        and version specification.
                      </p>
                    </div>
                    <div className="w-full">
                      <TextArea
                        placeholder="Enter headers template"
                        value={data?.metadata?.header_template}
                        onChange={(e) =>
                          handleChange(
                            'metadata.header_template',
                            e.target.value
                          )
                        }
                      />
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
                  <div className="flex items-start justify-between gap-x-2">
                    <div className="w-full sm:w-3/4">
                      <h6 className="line-clamp-1 font-semibold">
                        Request Format Conversion
                      </h6>
                      <p className="mt-1 text-[hsla(var(--text-secondary))]">
                        Template to transform OpenAI-compatible requests into
                        provider-specific format.
                      </p>
                    </div>
                    <div className="w-full">
                      <TextArea
                        placeholder="Enter conversion function"
                        value={
                          data?.metadata?.transform_req?.chat_completions
                            ?.template
                        }
                        onChange={(e) =>
                          handleChange(
                            'metadata.transform_req.chat_completions.template',
                            e.target.value
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="block w-full px-4">
            <div className="mb-3 mt-4 pb-4">
              <div className="flex w-full flex-col items-start justify-between sm:flex-row">
                <div className="w-full flex-shrink-0 space-y-1.5">
                  <div className="flex items-start justify-between gap-x-2">
                    <div className="w-full sm:w-3/4">
                      <h6 className="line-clamp-1 font-semibold">
                        Response Format Conversion
                      </h6>
                      <p className="mt-1 text-[hsla(var(--text-secondary))]">
                        Template to transform provider responses into
                        OpenAI-compatible format.
                      </p>
                    </div>
                    <div className="w-full">
                      <TextArea
                        placeholder="Enter conversion function"
                        value={
                          data?.metadata?.transform_resp?.chat_completions
                            ?.template
                        }
                        onChange={(e) =>
                          handleChange(
                            'metadata.transform_resp.chat_completions.template',
                            e.target.value
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </ScrollArea>
  )
}

export default RemoteEngineSettings
