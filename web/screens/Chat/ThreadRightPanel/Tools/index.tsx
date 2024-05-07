import { Fragment, useCallback } from 'react'

import { Tooltip, Switch, Input } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import { InfoIcon } from 'lucide-react'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import { getConfigurationsData } from '@/utils/componentSettings'

import AssistantSetting from '../../AssistantSetting'

import { experimentalFeatureEnabledAtom } from '@/helpers/atoms/AppConfig.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const Tools = () => {
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
          <div className="p-4">
            <div className="mb-2">
              <div className="flex items-center justify-between">
                <label
                  id="retrieval"
                  className="inline-flex items-center font-medium"
                >
                  Retrieval
                  <Tooltip
                    trigger={
                      <InfoIcon
                        size={16}
                        className="ml-2 flex-shrink-0 text-[hsl(var(--text-secondary))]"
                      />
                    }
                    content="Retrieval helps the assistant use information from
                      files you send to it. Once you share a file, the
                      assistant automatically fetches the relevant content
                      based on your request."
                  />
                </label>
                <div className="flex items-center justify-between">
                  <Switch
                    name="retrieval"
                    className="mr-2"
                    checked={activeThread?.assistants[0].tools[0].enabled}
                    onChange={(e) => onRetrievalSwitchUpdate(e.target.checked)}
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
                      className="inline-flex font-medium"
                    >
                      Embedding Model
                    </label>
                    <Tooltip
                      trigger={
                        <InfoIcon
                          size={16}
                          className="ml-2 flex-shrink-0 text-[hsl(var(--text-secondary))]"
                        />
                      }
                      content="Embedding model is crucial for understanding and
                        processing the input text effectively by
                        converting text to numerical representations.
                        Align the model choice with your task, evaluate
                        its performance, and consider factors like
                        resource availability. Experiment to find the best
                        fit for your specific use case."
                    />
                  </div>
                  <div className="w-full">
                    <Input value={selectedModel?.name} disabled />
                  </div>
                </div>
                <div className="mb-4">
                  <div className="mb-2 flex items-center">
                    <label
                      id="vector-database"
                      className="inline-block font-medium"
                    >
                      Vector Database
                    </label>
                    <Tooltip
                      trigger={
                        <InfoIcon
                          size={16}
                          className="ml-2 flex-shrink-0 text-[hsl(var(--text-secondary))]"
                        />
                      }
                      content="Vector Database is crucial for efficient storage
                        and retrieval of embeddings. Consider your
                        specific task, available resources, and language
                        requirements. Experiment to find the best fit for
                        your specific use case."
                    />
                  </div>

                  <div className="w-full">
                    <Input value="HNSWLib" disabled />
                  </div>
                </div>
                <AssistantSetting
                  componentData={componentDataAssistantSetting}
                />
              </div>
            )}
          </div>
        )}
    </Fragment>
  )
}

export default Tools
