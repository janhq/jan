import { useCallback } from 'react'

import { SettingComponentProps } from '@janhq/core/.'

import { useAtomValue, useSetAtom } from 'jotai'

import { useActiveModel } from '@/hooks/useActiveModel'
import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import SettingComponentBuilder from '../../Chat/ModelSetting/SettingComponent'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'
import {
  activeThreadAtom,
  engineParamsUpdateAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  componentData: SettingComponentProps[]
}

const EngineSetting: React.FC<Props> = ({ componentData }) => {
  const isLocalServerRunning = useAtomValue(serverEnabledAtom)
  const activeThread = useAtomValue(activeThreadAtom)

  const { stopModel } = useActiveModel()
  const { updateModelParameter } = useUpdateModelParameters()

  const setEngineParamsUpdate = useSetAtom(engineParamsUpdateAtom)

  const onValueChanged = useCallback(
    (key: string, value: string | number | boolean) => {
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
    <SettingComponentBuilder
      componentProps={componentData}
      enabled={!isLocalServerRunning}
      onValueUpdated={onValueChanged}
    />
  )
}

export default EngineSetting
