import { Fragment, useCallback, useState } from 'react'

import {
  EngineManager,
  InferenceEngine,
  Model,
  ModelSettingParams,
} from '@janhq/core'
import { Button, Tooltip, Select, Input, Checkbox } from '@janhq/joi'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ExternalLinkIcon, InfoIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import LeftPanelContainer from '@/containers/LeftPanelContainer'

import { toaster } from '@/containers/Toast'

import { useActiveModel, loadModelErrorAtom } from '@/hooks/useActiveModel'

import {
  apiServerCorsEnabledAtom,
  apiServerHostAtom,
  apiServerPortAtom,
  apiServerPrefix,
  apiServerVerboseLogEnabledAtom,
  hostOptions,
} from '@/helpers/atoms/ApiServer.atom'

import {
  LocalAPIserverModelParamsAtom,
  serverEnabledAtom,
} from '@/helpers/atoms/LocalServer.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'

const LocalServerLeftPanel = () => {
  const [errorRangePort, setErrorRangePort] = useState(false)
  const [errorPrefix, setErrorPrefix] = useState(false)
  const [serverEnabled, setServerEnabled] = useAtom(serverEnabledAtom)
  const [isLoading, setIsLoading] = useState(false)

  const { stateModel } = useActiveModel()
  const selectedModel = useAtomValue(selectedModelAtom)

  const [isCorsEnabled, setIsCorsEnabled] = useAtom(apiServerCorsEnabledAtom)
  const [isVerboseEnabled, setIsVerboseEnabled] = useAtom(
    apiServerVerboseLogEnabledAtom
  )
  const [host, setHost] = useAtom(apiServerHostAtom)
  const [port, setPort] = useAtom(apiServerPortAtom)
  const [prefix, setPrefix] = useAtom(apiServerPrefix)
  const setLoadModelError = useSetAtom(loadModelErrorAtom)
  const localAPIserverModelParams = useAtomValue(LocalAPIserverModelParamsAtom)
  const FIRST_TIME_VISIT_API_SERVER = 'firstTimeVisitAPIServer'

  const model: Model | undefined = selectedModel
    ? {
        ...selectedModel,
        object: selectedModel.object || '',
        settings: (typeof localAPIserverModelParams === 'object'
          ? { ...(localAPIserverModelParams as ModelSettingParams) }
          : { ...selectedModel.settings }) as ModelSettingParams,
      }
    : undefined

  const [firstTimeVisitAPIServer, setFirstTimeVisitAPIServer] =
    useState<boolean>(false)

  const handleChangePort = useCallback(
    (value: string) => {
      setErrorRangePort(Number(value) <= 0 || Number(value) >= 65536)
      setPort(value)
    },
    [setPort]
  )

  const handleChangePrefix = useCallback(
    (value: string) => {
      setErrorPrefix(!value.length || !value.startsWith('/'))
      setPrefix(value)
    },
    [setPrefix]
  )

  const onStartServerClick = async () => {
    if (selectedModel == null) return
    try {
      setIsLoading(true)
      const isStarted = await window.core?.api?.startServer({
        host,
        port,
        prefix,
        isCorsEnabled,
        isVerboseEnabled,
      })
      if (isStarted) setServerEnabled(true)
      if (firstTimeVisitAPIServer) {
        localStorage.setItem(FIRST_TIME_VISIT_API_SERVER, 'false')
        setFirstTimeVisitAPIServer(false)
      }
      const engine = EngineManager.instance().get(InferenceEngine.cortex)
      engine?.loadModel(model as Model)
      // startModel(selectedModel.id, false).catch((e) => console.error(e))
      setIsLoading(false)
    } catch (e) {
      console.error(e)
      setIsLoading(false)
      toaster({
        title: `Failed to start server!`,
        description: 'Please check Server Logs for more details.',
        type: 'error',
      })
    }
  }

  const onStopServerClick = async () => {
    window.core?.api?.stopServer()
    setServerEnabled(false)
    setLoadModelError(undefined)
    setIsLoading(false)
  }

  const onToggleServer = async () => {
    if (serverEnabled) {
      await onStopServerClick()
    } else {
      await onStartServerClick()
    }
  }

  return (
    <LeftPanelContainer>
      <Fragment>
        <div className="p-3">
          <p className="leading-relaxed text-[hsla(var(--text-secondary))]">
            Start an OpenAI-compatible local HTTP server.
          </p>
        </div>
        <div className="w-full border-b border-[hsla(var(--app-border))] p-3 pb-6">
          <div className="-mt-2 flex w-full flex-shrink flex-col gap-y-2">
            <Button
              block
              theme={serverEnabled ? 'destructive' : 'primary'}
              disabled={
                isLoading ||
                stateModel.loading ||
                errorRangePort ||
                errorPrefix ||
                !selectedModel
              }
              onClick={onToggleServer}
            >
              {isLoading
                ? 'Starting...'
                : serverEnabled
                  ? 'Stop Server'
                  : 'Start Server'}
            </Button>
            {serverEnabled && (
              <Button variant="soft" asChild className="whitespace-nowrap">
                <a href={`http://localhost:${port}`} target="_blank">
                  <span>API Playground</span>{' '}
                  <ExternalLinkIcon size={20} className="ml-2" />
                </a>
              </Button>
            )}
          </div>
        </div>

        <div className="p-3">
          <p className="mb-2 block font-semibold">Server Options</p>

          <div className="flex w-full">
            <Select
              value={host}
              onValueChange={(e) => setHost(e)}
              disabled={serverEnabled}
              options={hostOptions}
              block
            />
          </div>

          <div className="relative mt-2 block">
            <Input
              className={twMerge(
                errorRangePort && 'border-[hsla(var(--destructive-bg))]'
              )}
              type="number"
              value={port}
              onChange={(e) => {
                handleChangePort(e.target.value)
              }}
              maxLength={5}
              disabled={serverEnabled}
            />
          </div>

          {errorRangePort && (
            <p className="mt-2 text-xs text-[hsla(var(--destructive-bg))]">{`The port range should be from 0 to 65536`}</p>
          )}
        </div>

        <div className="space-y-4 px-3">
          <div className="block">
            <label
              id="prefix"
              className="mb-2 inline-flex items-start gap-x-2 font-bold "
            >
              API Prefix
            </label>
            <div className="block">
              <Input
                className={twMerge(
                  'w-full flex-shrink-0',
                  errorPrefix && 'border-[hsla(var(--destructive-bg))]'
                )}
                type="text"
                value={prefix}
                onChange={(e) => {
                  handleChangePrefix(e.target.value)
                }}
                disabled={serverEnabled}
              />
            </div>
            {errorPrefix && (
              <p className="mt-2 text-xs text-[hsla(var(--destructive-bg))]">{`Prefix should start with /`}</p>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Checkbox
                id="cors"
                label={
                  <div className="flex items-start gap-x-2 ">
                    <span>Cross-Origin-Resource-Sharing (CORS)</span>
                    <Tooltip
                      side="right"
                      trigger={
                        <InfoIcon
                          size={16}
                          className="mt-0.5 flex-shrink-0 text-[hsla(var(--text-secondary))]"
                        />
                      }
                      content="CORS (Cross-Origin Resource Sharing) manages resource access on this server from external domains. Enable for secure inter-website communication, regulating data sharing to bolster overall security."
                    />
                  </div>
                }
                checked={isCorsEnabled}
                onChange={(e) => setIsCorsEnabled(e.target.checked)}
                name="cors"
                disabled={serverEnabled}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Checkbox
                id="verbose"
                label={
                  <div className="flex items-start gap-x-2 ">
                    <span>Verbose Server Logs</span>
                    <Tooltip
                      side="right"
                      trigger={
                        <InfoIcon
                          size={16}
                          className="mt-0.5 flex-shrink-0 text-[hsla(var(--text-secondary))]"
                        />
                      }
                      content="Verbose Server Logs provide extensive details about server activities. Enable to capture thorough records, aiding in troubleshooting and monitoring server performance effectively."
                    />
                  </div>
                }
                checked={isVerboseEnabled}
                onChange={(e) => setIsVerboseEnabled(e.target.checked)}
                name="verbose"
                disabled={serverEnabled}
              />
            </div>
          </div>
        </div>
      </Fragment>
    </LeftPanelContainer>
  )
}

export default LocalServerLeftPanel
