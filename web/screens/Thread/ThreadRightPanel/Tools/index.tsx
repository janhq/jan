import { Fragment, useCallback, useEffect } from 'react'

import { Tooltip, Switch, Input } from '@janhq/joi'
import { useAtom, useAtomValue } from 'jotai'

import { InfoIcon } from 'lucide-react'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import useRecommendedModel from '@/hooks/useRecommendedModel'

import AssistantSetting from '@/screens/Thread/ThreadCenterPanel/AssistantSetting'

import { getConfigurationsData } from '@/utils/componentSettings'

import { experimentalFeatureEnabledAtom } from '@/helpers/atoms/AppConfig.atom'
import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const Tools = () => {
  const experimentalFeature = useAtomValue(experimentalFeatureEnabledAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)
  const { updateThreadMetadata } = useCreateNewThread()
  const { recommendedModel, downloadedModels } = useRecommendedModel()

  const componentDataAssistantSetting = getConfigurationsData(
    (activeAssistant?.tools && activeAssistant?.tools[0]?.settings) ?? {}
  )

  useEffect(() => {
    if (!activeThread) return
    let model = downloadedModels.find(
      (model) => model.id === activeAssistant?.model.id
    )
    if (!model) {
      model = recommendedModel
    }
    setSelectedModel(model)
  }, [
    recommendedModel,
    activeThread,
    downloadedModels,
    setSelectedModel,
    activeAssistant?.model.id,
  ])

  const onRetrievalSwitchUpdate = useCallback(
    (enabled: boolean) => {
      if (!activeThread || !activeAssistant) return
      updateThreadMetadata({
        ...activeThread,
        assistants: [
          {
            ...activeAssistant,
            tools: [
              {
                type: 'retrieval',
                enabled: enabled,
                settings:
                  (activeAssistant.tools &&
                    activeAssistant.tools[0]?.settings) ??
                  {},
              },
            ],
          },
        ],
      })
    },
    [activeAssistant, activeThread, updateThreadMetadata]
  )

  const onTimeWeightedRetrieverSwitchUpdate = useCallback(
    (enabled: boolean) => {
      if (!activeThread || !activeAssistant) return
      updateThreadMetadata({
        ...activeThread,
        assistants: [
          {
            ...activeAssistant,
            tools: [
              {
                type: 'retrieval',
                enabled: true,
                useTimeWeightedRetriever: enabled,
                settings:
                  (activeAssistant.tools &&
                    activeAssistant.tools[0]?.settings) ??
                  {},
              },
            ],
          },
        ],
      })
    },
    [activeAssistant, activeThread, updateThreadMetadata]
  )

  if (!experimentalFeature) return null

  return (
    <Fragment>
      {activeAssistant?.tools && componentDataAssistantSetting.length > 0 && (
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
                  checked={activeAssistant?.tools[0].enabled}
                  onChange={(e) => onRetrievalSwitchUpdate(e.target.checked)}
                />
              </div>
            </div>
          </div>
          {activeAssistant?.tools[0].enabled && (
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
                  <Input value={selectedModel?.name || ''} disabled readOnly />
                </div>
              </div>
              <div className="mb-4">
                <div className="mb-2 flex items-center">
                  <label
                    id="vector-database"
                    className="inline-flex items-center font-medium"
                  >
                    Vector Database
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
                  </label>
                </div>

                <div className="w-full">
                  <Input value="HNSWLib" disabled readOnly />
                </div>
              </div>
              <div className="mb-4">
                <div className="mb-2 flex items-center">
                  <label
                    id="use-time-weighted-retriever"
                    className="inline-block font-medium"
                  >
                    Time-Weighted Retrieval?
                  </label>
                  <Tooltip
                    trigger={
                      <InfoIcon
                        size={16}
                        className="ml-2 flex-shrink-0 text-[hsl(var(--text-secondary))]"
                      />
                    }
                    content="Time-Weighted Retriever looks at how similar
                                they are and how new they are. It compares
                                documents based on their meaning like usual, but
                                also considers when they were added to give
                                newer ones more importance."
                  />
                  <div className="ml-auto flex items-center justify-between">
                    <Switch
                      name="use-time-weighted-retriever"
                      checked={
                        activeAssistant?.tools[0].useTimeWeightedRetriever ||
                        false
                      }
                      onChange={(e) =>
                        onTimeWeightedRetrieverSwitchUpdate(e.target.checked)
                      }
                    />
                  </div>
                </div>
              </div>
              <AssistantSetting componentData={componentDataAssistantSetting} />
            </div>
          )}
        </div>
      )}
    </Fragment>
  )
}

export default Tools
