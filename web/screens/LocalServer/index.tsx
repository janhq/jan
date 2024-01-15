/* eslint-disable @typescript-eslint/naming-convention */
import { useEffect, useState } from 'react'

import {
  Button,
  Switch,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
  Select,
  SelectContent,
  SelectItem,
  Input,
  SelectTrigger,
  SelectValue,
} from '@janhq/uikit'
// import hljs from 'highlight.js'
import { useAtom, useAtomValue } from 'jotai'

import { Paintbrush, CodeIcon } from 'lucide-react'
import { ExternalLinkIcon, InfoIcon } from 'lucide-react'

// import { Marked, Renderer } from 'marked'
// import { markedHighlight } from 'marked-highlight'
import { twMerge } from 'tailwind-merge'

import CardSidebar from '@/containers/CardSidebar'
import DropdownListSidebar from '@/containers/DropdownListSidebar'

import { useServerLog } from '@/hooks/useServerLog'

import { getConfigurationsData } from '@/utils/componentSettings'
import { toRuntimeParams, toSettingParams } from '@/utils/modelParam'

import EngineSetting from '../Chat/EngineSetting'
import ModelSetting from '../Chat/ModelSetting'
import settingComponentBuilder from '../Chat/ModelSetting/settingComponentBuilder'
import { showRightSideBarAtom } from '../Chat/Sidebar'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'
import { getActiveThreadModelParamsAtom } from '@/helpers/atoms/Thread.atom'

const LocalServerScreen = () => {
  const [serverEnabled, setServerEnabled] = useAtom(serverEnabledAtom)
  const showing = useAtomValue(showRightSideBarAtom)
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)

  const modelEngineParams = toSettingParams(activeModelParams)
  const modelRuntimeParams = toRuntimeParams(activeModelParams)
  const componentDataEngineSetting = getConfigurationsData(modelEngineParams)
  const componentDataRuntimeSetting = getConfigurationsData(modelRuntimeParams)
  const { getServerLog, openServerLog, clearServerLog } = useServerLog()
  const [logs, setLogs] = useState([])

  useEffect(() => {
    getServerLog().then((log) => {
      // setLogs(log)
      // console.log(log)
      setLogs(log.split(/\r?\n|\r|\n/g))
      // setLogs(JSON.stringify(log, null, 2))
    })
  }, [])

  // const marked: Marked = new Marked(
  //   markedHighlight({
  //     langPrefix: 'hljs',
  //     highlight(code) {
  //       return hljs.highlightAuto(code).value
  //     },
  //   }),
  //   {
  //     renderer: {
  //       link: (href, title, text) => {
  //         return Renderer.prototype.link
  //           ?.apply(this, [href, title, text])
  //           .replace('<a', "<a target='_blank'")
  //       },
  //     },
  //   }
  // )

  // const parsedText = marked.parse(logs)

  return (
    <div className="flex h-full w-full">
      {/* Left SideBar */}
      <div className="flex h-full w-60 flex-shrink-0 flex-col overflow-y-auto border-r border-border">
        <div className="p-4">
          <h2 className="font-bold">Server Options</h2>
          <p className="mt-2 leading-relaxed">
            Start an OpenAI-compatible local HTTP server.
          </p>
        </div>
        <div className="border-b border-border pb-8">
          <div className="space-y-3 px-4">
            <Button
              block
              themes={serverEnabled ? 'danger' : 'success'}
              onClick={() => {
                if (serverEnabled) {
                  window.core?.api?.stopServer()
                  setServerEnabled(false)
                } else {
                  window.core?.api?.startServer()
                  setServerEnabled(true)
                }
              }}
            >
              {serverEnabled ? 'Stop' : 'Start'} Server
            </Button>
            <Button block themes="secondaryBlue" asChild>
              <a href="https://jan.ai/api-reference/" target="_blank">
                API Reference <ExternalLinkIcon size={20} className="ml-2" />
              </a>
            </Button>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <div className="flex w-full flex-shrink-0 items-center gap-x-2">
            <Select value="127.0.0.1" onValueChange={(e) => console.log(e)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="127.0.0.1">127.0.0.1</SelectItem>
                <SelectItem value="0.0.0.0">0.0.0.0</SelectItem>
              </SelectContent>
            </Select>

            <Input className="w-[60px] flex-shrink-0" value="1337" />
          </div>
          <div>
            <label
              id="cors"
              className="mb-2 inline-flex items-start gap-x-2 font-bold text-zinc-500 dark:text-gray-300"
            >
              Cross-Origin-Resource-Sharing (CORS)
              <Tooltip>
                <TooltipTrigger asChild>
                  <InfoIcon
                    size={16}
                    className="mt-0.5 flex-shrink-0 dark:text-gray-500"
                  />
                </TooltipTrigger>
                <TooltipPortal>
                  <TooltipContent side="top" className="max-w-[240px]">
                    <span>
                      CORS (Cross-Origin Resource Sharing) manages resource
                      access on this server from external domains. Enable for
                      secure inter-website communication, regulating data
                      sharing to bolster overall security.
                    </span>
                    <TooltipArrow />
                  </TooltipContent>
                </TooltipPortal>
              </Tooltip>
            </label>
            <div className="flex items-center justify-between">
              <Switch name="cors" />
            </div>
          </div>
          <div>
            <label
              id="verbose"
              className="mb-2 inline-flex items-start gap-x-2 font-bold text-zinc-500 dark:text-gray-300"
            >
              Verbose Server Logs
              <Tooltip>
                <TooltipTrigger asChild>
                  <InfoIcon
                    size={16}
                    className="mt-0.5 flex-shrink-0 dark:text-gray-500"
                  />
                </TooltipTrigger>
                <TooltipPortal>
                  <TooltipContent side="top" className="max-w-[240px]">
                    <span>
                      Verbose Server Logs provide extensive details about server
                      activities. Enable to capture thorough records, aiding in
                      troubleshooting and monitoring server performance
                      effectively.
                    </span>
                    <TooltipArrow />
                  </TooltipContent>
                </TooltipPortal>
              </Tooltip>
            </label>
            <div className="flex items-center justify-between">
              <Switch name="verbose" />
            </div>
          </div>
        </div>
      </div>

      {/* Middle Bar */}
      <div className="relative flex h-full w-full flex-col overflow-auto bg-background">
        <div className="sticky top-0 flex  items-center justify-between bg-zinc-100 px-4 py-2">
          <h2 className="font-bold">Server Logs</h2>
          <div className="space-x-2">
            <Button
              size="sm"
              themes="outline"
              className="bg-white"
              onClick={() => openServerLog()}
            >
              <CodeIcon size={16} className="mr-2" />
              Open Logs
            </Button>
            <Button
              size="sm"
              themes="outline"
              className="bg-white"
              onClick={() => clearServerLog()}
            >
              <Paintbrush size={16} className="mr-2" />
              Clear
            </Button>
          </div>
        </div>
        <div className="p-4">
          <code className="text-xs">
            {/* <div
              dangerouslySetInnerHTML={{
                __html: parsedText,
              }}
            /> */}

            {logs.map((log, i) => {
              return (
                <p key={i} className="my-2 leading-relaxed">
                  {log}
                </p>
              )
            })}
          </code>
        </div>
      </div>

      {/* Right bar */}
      <div
        className={twMerge(
          'h-full flex-shrink-0 overflow-x-hidden border-l border-border bg-background transition-all duration-100 dark:bg-background/20',
          showing
            ? 'w-80 translate-x-0 opacity-100'
            : 'w-0 translate-x-full opacity-0'
        )}
      >
        <CardSidebar title="Model" hideMoreVerticalAction>
          <div className="px-2">
            <div className="mt-4">
              <DropdownListSidebar />
            </div>

            {componentDataRuntimeSetting.length !== 0 && (
              <div className="mt-6">
                <CardSidebar title="Inference Parameters" asChild>
                  <div className="px-2 py-4">
                    <ModelSetting />
                  </div>
                </CardSidebar>
              </div>
            )}

            {componentDataEngineSetting.filter(
              (x) => x.name === 'prompt_template'
            ).length !== 0 && (
              <div className="mt-4">
                <CardSidebar title="Model Parameters" asChild>
                  <div className="px-2 py-4">
                    {settingComponentBuilder(componentDataEngineSetting, true)}
                  </div>
                </CardSidebar>
              </div>
            )}

            {componentDataEngineSetting.length !== 0 && (
              <div className="my-4">
                <CardSidebar title="Engine Parameters" asChild>
                  <div className="px-2 py-4">
                    <EngineSetting />
                  </div>
                </CardSidebar>
              </div>
            )}
          </div>
        </CardSidebar>
      </div>
    </div>
  )
}

export default LocalServerScreen
