import { Fragment, useCallback } from 'react'

import {
  Tooltip,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipArrow,
  Switch,
  Input,
} from '@janhq/uikit'
import { useAtomValue } from 'jotai'

import { InfoIcon } from 'lucide-react'

import CardSidebar from '@/containers/CardSidebar'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import { getConfigurationsData } from '@/utils/componentSettings'

import AssistantSetting from '../../AssistantSetting'

import { experimentalFeatureEnabledAtom } from '@/helpers/atoms/AppConfig.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const AssistantTool: React.FC = () => {
  const experimentalFeature = useAtomValue(experimentalFeatureEnabledAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const { updateThreadMetadata } = useCreateNewThread()

  const componentDataAssistantSetting = getConfigurationsData(
    (activeThread?.assistants[0]?.tools &&
      activeThread?.assistants[0]?.tools[0]?.settings) ??
      {}
  )

  const onRetrievalSwitchUpdate = useCallback(
    (enabled: boolean) => {
      if (!activeThread) return
      updateThreadMetadata({
        ...activeThread,
        assistants: [
          {
            ...activeThread.assistants[0],
            tools: [
              {
                type: 'retrieval',
                enabled: enabled,
                settings:
                  (activeThread.assistants[0].tools &&
                    activeThread.assistants[0].tools[0]?.settings) ??
                  {},
              },
            ],
          },
        ],
      })
    },
    [activeThread, updateThreadMetadata]
  )

  if (!experimentalFeature) return null

  return (
    <Fragment>
      {activeThread?.assistants[0]?.tools &&
        componentDataAssistantSetting.length > 0 && (
          <CardSidebar title="Tools" isShow={true}>
            <div className="px-2 pt-4">
              <div className="mb-2">
                <div className="flex items-center justify-between">
                  <label
                    id="retrieval"
                    className="inline-flex items-center font-bold text-zinc-500 dark:text-gray-300"
                  >
                    Retrieval
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <InfoIcon
                          size={16}
                          className="ml-2 flex-shrink-0 text-black dark:text-gray-500"
                        />
                      </TooltipTrigger>
                      <TooltipPortal>
                        <TooltipContent side="top" className="max-w-[240px]">
                          <span>
                            Retrieval helps the assistant use information from
                            files you send to it. Once you share a file, the
                            assistant automatically fetches the relevant content
                            based on your request.
                          </span>
                          <TooltipArrow />
                        </TooltipContent>
                      </TooltipPortal>
                    </Tooltip>
                  </label>

                  <div className="flex items-center justify-between">
                    <Switch
                      name="retrieval"
                      className="mr-2"
                      checked={activeThread?.assistants[0].tools[0].enabled}
                      onCheckedChange={onRetrievalSwitchUpdate}
                    />
                  </div>
                </div>
              </div>
              {activeThread?.assistants[0]?.tools[0].enabled && (
                <div className="pb-4 pt-2">
                  <div className="mb-4">
                    <div className="item-center mb-2 flex">
                      <label
                        id="embedding-model"
                        className="inline-flex font-bold text-zinc-500 dark:text-gray-300"
                      >
                        Embedding Model
                      </label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <InfoIcon
                            size={16}
                            className="ml-2 flex-shrink-0 dark:text-gray-500"
                          />
                        </TooltipTrigger>
                        <TooltipPortal>
                          <TooltipContent side="top" className="max-w-[240px]">
                            <span>
                              Embedding model is crucial for understanding and
                              processing the input text effectively by
                              converting text to numerical representations.
                              Align the model choice with your task, evaluate
                              its performance, and consider factors like
                              resource availability. Experiment to find the best
                              fit for your specific use case.
                            </span>
                            <TooltipArrow />
                          </TooltipContent>
                        </TooltipPortal>
                      </Tooltip>
                    </div>

                    <div className="flex items-center justify-between">
                      <Input value={selectedModel?.name} disabled />
                    </div>
                  </div>
                  <div className="mb-4">
                    <div className="mb-2 flex items-center">
                      <label
                        id="vector-database"
                        className="inline-block font-bold text-zinc-500 dark:text-gray-300"
                      >
                        Vector Database
                      </label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <InfoIcon
                            size={16}
                            className="ml-2 flex-shrink-0 dark:text-gray-500"
                          />
                        </TooltipTrigger>
                        <TooltipPortal>
                          <TooltipContent side="top" className="max-w-[240px]">
                            <span>
                              Vector Database is crucial for efficient storage
                              and retrieval of embeddings. Consider your
                              specific task, available resources, and language
                              requirements. Experiment to find the best fit for
                              your specific use case.
                            </span>
                            <TooltipArrow />
                          </TooltipContent>
                        </TooltipPortal>
                      </Tooltip>
                    </div>

                    <div className="flex items-center justify-between">
                      <Input value="HNSWLib" disabled />
                    </div>
                  </div>
                  <AssistantSetting
                    componentData={componentDataAssistantSetting}
                  />
                </div>
              )}
            </div>
          </CardSidebar>
        )}
    </Fragment>
  )
}

export default AssistantTool
