import React, { useCallback, useRef } from 'react'

import {
  EngineConfig as OriginalEngineConfig,
  InferenceEngine,
} from '@janhq/core'

interface EngineConfig extends OriginalEngineConfig {
  [key: string]: any
}

import { ScrollArea, Input, TextArea } from '@janhq/joi'

import {
  updateEngine,
  useGetEngines,
  useGetRemoteModels,
} from '@/hooks/useEngineManagement'
import { twMerge } from 'tailwind-merge'
import { ChevronRight } from 'lucide-react'

const RemoteEngineSettings = ({
  engine: name,
}: {
  engine: InferenceEngine
}) => {
  const { engines, mutate } = useGetEngines()
  // TODO: Check this endpoint
  const { remoteModels } = useGetRemoteModels(name)

  const fakeData = [
    { name: 'Claude 3 Opus Latest' },
    { name: 'Claude 3 Opus Latest' },
    { name: 'Claude 3 Opus Latest' },
  ]

  const engine =
    engines &&
    Object.entries(engines)
      .filter(([key]) => key === name)
      .flatMap(([_, engineArray]) => engineArray as EngineConfig)[0]

  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const handleChange = useCallback(
    (field: string, value: any) => {
      if (!engine) return

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(async () => {
        const updatedEngine = { ...engine }
        const fieldPath = field.split('.')
        let current = updatedEngine

        for (let i = 0; i < fieldPath.length - 1; i++) {
          if (fieldPath[i] in current) {
            current = current[fieldPath[i]] as any
          }
        }

        current[fieldPath[fieldPath.length - 1]] = value
        await updateEngine(name, updatedEngine)
        mutate()
      }, 300)
    },
    [engine, name]
  )

  return (
    <ScrollArea className="h-full w-full">
      <div className="block w-full px-4">
        <div className="mb-3 mt-4 border-b border-[hsla(var(--app-border))] pb-4">
          <div className="flex w-full flex-col items-start justify-between sm:flex-row">
            <div className="w-full flex-shrink-0 space-y-1.5">
              <div className="flex items-start justify-between gap-x-2">
                <div className="w-full sm:w-3/4">
                  <h6 className="line-clamp-1 font-semibold">API Key</h6>
                  <p className="mt-1 text-[hsla(var(--text-secondary))]">
                    Enter your authentication key to activate this engine.
                  </p>
                </div>
                <div className="w-full">
                  <Input
                    placeholder="Enter API Key"
                    defaultValue={engine?.api_key}
                    onChange={(e) => handleChange('api_key', e.target.value)}
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
            <div className="w-full flex-shrink-0 ">
              <div className="flex items-center justify-between gap-x-2">
                <div>
                  <h6 className="mb-2 line-clamp-1 font-semibold">Model</h6>
                </div>
              </div>

              <div>
                {fakeData &&
                  fakeData?.map((item, i) => {
                    return (
                      <div
                        key={i}
                        className={twMerge(
                          'border border-b-0 border-[hsla(var(--app-border))] bg-[hsla(var(--tertiary-bg))] p-4 first:rounded-t-lg last:rounded-b-lg last:border-b',
                          fakeData?.length === 1 && 'rounded-lg'
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

      <div className="px-4">
        <p className="flex items-center text-sm font-medium text-[hsla(var(--text-secondary))]">
          <span>Advance Settings</span>
          <span>
            <ChevronRight size={14} className="ml-1" />
          </span>
        </p>
      </div>

      <div>
        <div className="block w-full px-4">
          <div className="mb-3 mt-4 border-b border-[hsla(var(--app-border))] pb-4">
            <div className="flex w-full flex-col items-start justify-between sm:flex-row">
              <div className="w-full flex-shrink-0 space-y-1.5">
                <div className="flex items-start justify-between gap-x-2">
                  <div className="w-full sm:w-3/4">
                    <h6 className="line-clamp-1 font-semibold">API URL</h6>
                    <p className="mt-1 text-[hsla(var(--text-secondary))]">
                      The base URL of the provider's API.
                    </p>
                  </div>
                  <div className="w-full">
                    <Input
                      placeholder="Enter API URL"
                      defaultValue={engine?.url}
                      onChange={(e) => handleChange('url', e.target.value)}
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
                      The base URL of the provider's API.
                    </p>
                  </div>
                  <div className="w-full">
                    <Input
                      placeholder="Enter model list URL"
                      defaultValue={engine?.metadata?.get_models_url}
                      onChange={(e) =>
                        handleChange('metadata.get_models_url', e.target.value)
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
                      API Key Template
                    </h6>
                    <p className="mt-1 text-[hsla(var(--text-secondary))]">
                      Template for authorization header format.
                    </p>
                  </div>
                  <div className="w-full">
                    <Input
                      placeholder="Enter API key template"
                      defaultValue={engine?.metadata?.api_key_template}
                      onChange={(e) =>
                        handleChange(
                          'metadata.api_key_template',
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
                      Function to convert Jan’s request format to this engine
                      API’s format.
                    </p>
                  </div>
                  <div className="w-full">
                    <TextArea
                      placeholder="Enter conversion function"
                      defaultValue={
                        engine?.metadata?.transform_req?.chat_completions
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
                      Function to convert Jan’s request format to this engine
                      API’s format.
                    </p>
                  </div>
                  <div className="w-full">
                    <TextArea
                      placeholder="Enter conversion function"
                      defaultValue={
                        engine?.metadata?.transform_resp?.chat_completions
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
    </ScrollArea>
  )
}

export default RemoteEngineSettings
