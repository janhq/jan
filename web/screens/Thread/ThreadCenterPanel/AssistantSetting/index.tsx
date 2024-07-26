import { useCallback } from 'react'

import { SettingComponentProps } from '@janhq/core'
import { useAtomValue } from 'jotai'

import useModels from '@/hooks/useModels'

import SettingComponentBuilder from '../../../../containers/ModelSetting/SettingComponent'

import { activeModelsAtom } from '@/helpers/atoms/Model.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

type Props = {
  componentData: SettingComponentProps[]
}

const AssistantSetting: React.FC<Props> = ({ componentData }) => {
  const activeThread = useAtomValue(activeThreadAtom)
  const activeModels = useAtomValue(activeModelsAtom)
  const { stopModel } = useModels()

  const onValueChanged = useCallback(
    (key: string, value: string | number | boolean) => {
      if (!activeThread) return
      console.log('onValueChanged', key, value)
      const shouldReloadModel =
        componentData.find((x) => x.key === key)?.requireModelReload ?? false
      if (shouldReloadModel) {
        const model = activeModels.find(
          (model) => activeThread.assistants[0]?.model === model.model
        )
        if (model) stopModel(model.model)
      }

      // if (
      //   activeThread.assistants[0].tools &&
      //   (key === 'chunk_overlap' || key === 'chunk_size')
      // ) {
      //   if (
      //     activeThread.assistants[0].tools[0]?.settings.chunk_size <
      //     activeThread.assistants[0].tools[0]?.settings.chunk_overlap
      //   ) {
      //     activeThread.assistants[0].tools[0].settings.chunk_overlap =
      //       activeThread.assistants[0].tools[0].settings.chunk_size
      //   }
      //   if (
      //     key === 'chunk_size' &&
      //     value < activeThread.assistants[0].tools[0].settings.chunk_overlap
      //   ) {
      //     activeThread.assistants[0].tools[0].settings.chunk_overlap = value
      //   } else if (
      //     key === 'chunk_overlap' &&
      //     value > activeThread.assistants[0].tools[0].settings.chunk_size
      //   ) {
      //     activeThread.assistants[0].tools[0].settings.chunk_size = value
      //   }
      // }
    },
    [activeModels, activeThread, componentData, stopModel]
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
