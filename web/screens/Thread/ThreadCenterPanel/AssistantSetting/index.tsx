import { useCallback } from 'react'

import { SettingComponentProps } from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import SettingComponentBuilder from '../../../../containers/ModelSetting/SettingComponent'

import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import {
  activeThreadAtom,
  engineParamsUpdateAtom,
  resetGeneratingResponseAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  componentData: SettingComponentProps[]
}

const AssistantSetting: React.FC<Props> = ({ componentData }) => {
  const activeThread = useAtomValue(activeThreadAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)
  const { updateThreadMetadata } = useCreateNewThread()
  const { stopModel } = useActiveModel()
  const setEngineParamsUpdate = useSetAtom(engineParamsUpdateAtom)
  const resetGenerating = useSetAtom(resetGeneratingResponseAtom)

  const onValueChanged = useCallback(
    (key: string, value: string | number | boolean | string[]) => {
      if (!activeThread || !activeAssistant) return
      const shouldReloadModel =
        componentData.find((x) => x.key === key)?.requireModelReload ?? false
      if (shouldReloadModel) {
        setEngineParamsUpdate(true)
        resetGenerating()
        stopModel()
      }

      if (
        activeAssistant?.tools &&
        (key === 'chunk_overlap' || key === 'chunk_size')
      ) {
        if (
          activeAssistant.tools[0]?.settings?.chunk_size <
          activeAssistant.tools[0]?.settings?.chunk_overlap
        ) {
          activeAssistant.tools[0].settings.chunk_overlap =
            activeAssistant.tools[0].settings.chunk_size
        }
        if (
          key === 'chunk_size' &&
          value < activeAssistant.tools[0].settings?.chunk_overlap
        ) {
          activeAssistant.tools[0].settings.chunk_overlap = value
        } else if (
          key === 'chunk_overlap' &&
          value > activeAssistant.tools[0].settings?.chunk_size
        ) {
          activeAssistant.tools[0].settings.chunk_size = value
        }
      }
      updateThreadMetadata({
        ...activeThread,
        assistants: [
          {
            ...activeAssistant,
            tools: [
              {
                type: 'retrieval',
                enabled: true,
                settings: {
                  ...(activeAssistant.tools &&
                    activeAssistant.tools[0]?.settings),
                  [key]: value,
                },
              },
            ],
          },
        ],
      })
    },
    [
      activeAssistant,
      activeThread,
      componentData,
      setEngineParamsUpdate,
      stopModel,
      updateThreadMetadata,
      resetGenerating,
    ]
  )

  if (!activeThread) return null
  if (componentData.length === 0) return null

  return (
    <SettingComponentBuilder
      componentProps={componentData}
      onValueUpdated={onValueChanged}
    />
  )
}

export default AssistantSetting
