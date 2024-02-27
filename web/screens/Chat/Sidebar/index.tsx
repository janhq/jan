/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useContext } from 'react'

import {
  Input,
  Textarea,
  Switch,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from '@janhq/uikit'

import { atom, useAtomValue } from 'jotai'

import { InfoIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'
import CardSidebar from '@/containers/CardSidebar'

import DropdownListSidebar, {
  selectedModelAtom,
} from '@/containers/DropdownListSidebar'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import { getConfigurationsData } from '@/utils/componentSettings'
import { toRuntimeParams, toSettingParams } from '@/utils/modelParam'

import AssistantSetting from '../AssistantSetting'
import EngineSetting from '../EngineSetting'
import ModelSetting from '../ModelSetting'

import SettingComponentBuilder from '../ModelSetting/SettingComponent'

import {
  activeThreadAtom,
  getActiveThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

export const showRightSideBarAtom = atom<boolean>(true)

const Sidebar: React.FC = () => {
  const showing = useAtomValue(showRightSideBarAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const { updateThreadMetadata } = useCreateNewThread()
  const { experimentalFeature } = useContext(FeatureToggleContext)

  const modelEngineParams = toSettingParams(activeModelParams)
  const modelRuntimeParams = toRuntimeParams(activeModelParams)
  const componentDataAssistantSetting = getConfigurationsData(
    (activeThread?.assistants[0]?.tools &&
      activeThread?.assistants[0]?.tools[0]?.settings) ??
      {}
  )
  const componentDataEngineSetting = getConfigurationsData(
    modelEngineParams,
    selectedModel
  )
  const componentDataRuntimeSetting = getConfigurationsData(
    modelRuntimeParams,
    selectedModel
  )

  return (
    <div
      className={twMerge(
        'h-full flex-shrink-0 overflow-x-hidden border-l border-border bg-background pb-6 transition-all duration-100',
        showing
          ? 'w-80 translate-x-0 opacity-100'
          : 'w-0 translate-x-full opacity-0'
      )}
    >
      <div
        className={twMerge(
          'flex flex-col gap-1 delay-200',
          showing ? 'animate-enter opacity-100' : 'opacity-0'
        )}
      >
        <div className="flex flex-col space-y-4 p-4">
          <div>
            <label
              id="thread-title"
              className="mb-2 inline-block font-bold text-gray-600"
            >
              Title
            </label>
            <Input
              id="thread-title"
              value={activeThread?.title}
              onChange={(e) => {
                if (activeThread)
                  updateThreadMetadata({
                    ...activeThread,
                    title: e.target.value || '',
                  })
              }}
            />
          </div>
          <div className="flex flex-col">
            <label
              id="thread-title"
              className="mb-2 inline-block font-bold text-zinc-500"
            >
              Threads ID
            </label>
            <span className="text-xs text-muted-foreground">
              {activeThread?.id || '-'}
            </span>
          </div>
        </div>

        <CardSidebar title="Assistant" isShow={true}>
          <div className="flex flex-col space-y-4 p-2">
            <div className="flex items-center space-x-2">
              <LogoMark width={24} height={24} />
              <span className="font-bold capitalize">
                {activeThread?.assistants[0].assistant_name ?? '-'}
              </span>
            </div>
            <div>
              <label
                id="thread-title"
                className="mb-2 inline-block font-bold text-zinc-500"
              >
                Instructions
              </label>
              <Textarea
                id="assistant-instructions"
                placeholder="Eg. You are a helpful assistant."
                value={activeThread?.assistants[0].instructions ?? ''}
                onChange={(e) => {
                  if (activeThread)
                    updateThreadMetadata({
                      ...activeThread,
                      assistants: [
                        {
                          ...activeThread.assistants[0],
                          instructions: e.target.value || '',
                        },
                      ],
                    })
                }}
              />
            </div>
          </div>
        </CardSidebar>

        <CardSidebar title="Model" isShow={true}>
          <div className="px-2 pt-4">
            <DropdownListSidebar />

            {componentDataRuntimeSetting.length > 0 && (
              <div className="mt-6">
                <CardSidebar title="Inference Parameters" asChild>
                  <div className="px-2 py-4">
                    <ModelSetting componentData={componentDataRuntimeSetting} />
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
                    <SettingComponentBuilder
                      componentData={componentDataEngineSetting}
                      selector={(x: any) => x.name === 'prompt_template'}
                    />
                  </div>
                </CardSidebar>
              </div>
            )}

            {componentDataEngineSetting.length > 0 && (
              <div className="my-4">
                <CardSidebar title="Engine Parameters" asChild>
                  <div className="px-2 py-4">
                    <EngineSetting componentData={componentDataEngineSetting} />
                  </div>
                </CardSidebar>
              </div>
            )}
          </div>
        </CardSidebar>

        {experimentalFeature && (
          <div>
            {activeThread?.assistants[0]?.tools &&
              componentDataAssistantSetting.length > 0 && (
                <CardSidebar title="Tools" isShow={true}>
                  <div className="px-2 pt-4">
                    <div className="mb-2">
                      <div className="flex items-center justify-between">
                        <label
                          id="retrieval"
                          className="inline-flex items-center font-bold text-zinc-500"
                        >
                          Retrieval
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <InfoIcon
                                size={16}
                                className="ml-2 flex-shrink-0 text-black"
                              />
                            </TooltipTrigger>
                            <TooltipPortal>
                              <TooltipContent
                                side="top"
                                className="max-w-[240px]"
                              >
                                <span>
                                  Retrieval helps the assistant use information
                                  from files you send to it. Once you share a
                                  file, the assistant automatically fetches the
                                  relevant content based on your request.
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
                            checked={
                              activeThread?.assistants[0].tools[0].enabled
                            }
                            onCheckedChange={(e) => {
                              if (activeThread)
                                updateThreadMetadata({
                                  ...activeThread,
                                  assistants: [
                                    {
                                      ...activeThread.assistants[0],
                                      tools: [
                                        {
                                          type: 'retrieval',
                                          enabled: e,
                                          settings:
                                            (activeThread.assistants[0].tools &&
                                              activeThread.assistants[0]
                                                .tools[0]?.settings) ??
                                            {},
                                        },
                                      ],
                                    },
                                  ],
                                })
                            }}
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
                              className="inline-flex font-bold text-zinc-500"
                            >
                              Embedding Model
                            </label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <InfoIcon
                                  size={16}
                                  className="ml-2 flex-shrink-0"
                                />
                              </TooltipTrigger>
                              <TooltipPortal>
                                <TooltipContent
                                  side="top"
                                  className="max-w-[240px]"
                                >
                                  <span>
                                    Embedding model is crucial for understanding
                                    and processing the input text effectively by
                                    converting text to numerical
                                    representations. Align the model choice with
                                    your task, evaluate its performance, and
                                    consider factors like resource availability.
                                    Experiment to find the best fit for your
                                    specific use case.
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
                              className="inline-block font-bold text-zinc-500"
                            >
                              Vector Database
                            </label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <InfoIcon
                                  size={16}
                                  className="ml-2 flex-shrink-0"
                                />
                              </TooltipTrigger>
                              <TooltipPortal>
                                <TooltipContent
                                  side="top"
                                  className="max-w-[240px]"
                                >
                                  <span>
                                    Vector Database is crucial for efficient
                                    storage and retrieval of embeddings.
                                    Consider your specific task, available
                                    resources, and language requirements.
                                    Experiment to find the best fit for your
                                    specific use case.
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
          </div>
        )}
      </div>
    </div>
  )
}

export default React.memo(Sidebar)
