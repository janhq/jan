import { Button } from '@janhq/uikit'
import { useAtom, useAtomValue } from 'jotai'

import { ExternalLinkIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import CardSidebar from '@/containers/CardSidebar'
import DropdownListSidebar from '@/containers/DropdownListSidebar'

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
      </div>

      {/* Middle Bar */}
      <div className="relative flex h-full w-full flex-col overflow-auto bg-background p-4">
        <div className="flex h-full w-full flex-col justify-between">
          <p>
            Lorem ipsum dolor sit amet, consectetur adipisicing elit. Eius iusto
            aspernatur blanditiis, culpa harum ex hic atque quae tempora eaque
            obcaecati voluptas nulla error repellat aliquam minima laborum
            corporis fuga.
          </p>
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
