import React, { useCallback } from 'react'

import { SettingComponentProps } from '@janhq/core/.'

import { useAtomValue } from 'jotai'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import SettingComponentBuilder from './SettingComponent'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

type Props = {
  componentProps: SettingComponentProps[]
}

const ModelSetting: React.FC<Props> = ({ componentProps }) => {
  const isLocalServerRunning = useAtomValue(serverEnabledAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const { updateModelParameter } = useUpdateModelParameters()

  const onValueChanged = useCallback(
    (key: string, value: string | number | boolean) => {
      if (!activeThread) return

      if (key === 'stop' && typeof value === 'string') {
        updateModelParameter(activeThread, {
          params: { [key]: [value] },
        })
      } else {
        updateModelParameter(activeThread, {
          params: { [key]: value },
        })
      }
    },
    [activeThread, updateModelParameter]
  )

  return (
    <SettingComponentBuilder
      enabled={!isLocalServerRunning}
      componentProps={componentProps}
      onValueUpdated={onValueChanged}
    />
  )
}

export default React.memo(ModelSetting)
