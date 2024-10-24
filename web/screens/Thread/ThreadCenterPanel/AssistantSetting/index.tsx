import { useCallback } from 'react'

import { SettingComponentProps } from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import SettingComponentBuilder from '../../../../containers/ModelSetting/SettingComponent'

import {
  activeThreadAtom,
  engineParamsUpdateAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  componentData: SettingComponentProps[]
}

const AssistantSetting: React.FC<Props> = ({ componentData }) => {
  const activeThread = useAtomValue(activeThreadAtom)
  const { updateThreadMetadata } = useCreateNewThread()
  const { stopModel } = useActiveModel()
  const setEngineParamsUpdate = useSetAtom(engineParamsUpdateAtom)

  const onValueChanged = useCallback(
    (key: string, value: string | number | boolean) => {
      if (!activeThread) return
      const shouldReloadModel =
        componentData.find((x) => x.key === key)?.requireModelReload ?? false
      if (shouldReloadModel) {
        setEngineParamsUpdate(true)
        stopModel()
      }

      if (
        activeThread.assistants[0].tools &&
        (key === 'chunk_overlap' || key === 'chunk_size')
      ) {
        if (
          activeThread.assistants[0].tools[0]?.settings?.chunk_size <
          activeThread.assistants[0].tools[0]?.settings?.chunk_overlap
        ) {
          activeThread.assistants[0].tools[0].settings.chunk_overlap =
            activeThread.assistants[0].tools[0].settings.chunk_size
        }
        if (
          key === 'chunk_size' &&
          value < activeThread.assistants[0].tools[0].settings?.chunk_overlap
        ) {
          activeThread.assistants[0].tools[0].settings.chunk_overlap = value
        } else if (
          key === 'chunk_overlap' &&
          value > activeThread.assistants[0].tools[0].settings?.chunk_size
        ) {
          activeThread.assistants[0].tools[0].settings.chunk_size = value
        }
      }
      updateThreadMetadata({
        ...activeThread,
        assistants: [
          {
            ...activeThread.assistants[0],
            tools: [
              {
                type: 'retrieval',
                enabled: true,
                settings: {
                  ...(activeThread.assistants[0].tools &&
                    activeThread.assistants[0].tools[0]?.settings),
                  [key]: value,
                },
              },
            ],
          },
        ],
      })
    },
    [
      activeThread,
      componentData,
      setEngineParamsUpdate,
      stopModel,
      updateThreadMetadata,
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
