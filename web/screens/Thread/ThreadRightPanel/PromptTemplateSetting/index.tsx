import { useCallback } from 'react'

import { SettingComponentProps } from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import { useActiveModel } from '@/hooks/useActiveModel'
import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import SettingComponent from '../../../../containers/ModelSetting/SettingComponent'

import {
  activeThreadAtom,
  engineParamsUpdateAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  componentData: SettingComponentProps[]
}

const PromptTemplateSetting: React.FC<Props> = ({ componentData }) => {
  const activeThread = useAtomValue(activeThreadAtom)

  const { stopModel } = useActiveModel()
  const { updateModelParameter } = useUpdateModelParameters()

  const setEngineParamsUpdate = useSetAtom(engineParamsUpdateAtom)
  const onValueChanged = useCallback(
    (key: string, value: string | number | boolean | string[]) => {
      if (!activeThread) return

      setEngineParamsUpdate(true)
      stopModel()

      updateModelParameter(activeThread, {
        params: { [key]: value },
      })
    },
    [activeThread, setEngineParamsUpdate, stopModel, updateModelParameter]
  )

  return (
    <SettingComponent
      componentProps={componentData}
      onValueUpdated={onValueChanged}
    />
  )
}

export default PromptTemplateSetting
