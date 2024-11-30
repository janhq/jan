import React from 'react'

import { SettingComponentProps } from '@janhq/core'

import SettingComponentBuilder from './SettingComponent'

type Props = {
  componentProps: SettingComponentProps[]
  onValueChanged: (
    key: string,
    value: string | number | boolean | string[]
  ) => void
  disabled?: boolean
}

const ModelSetting = ({
  componentProps,
  onValueChanged,
  disabled = false,
}: Props) => (
  <SettingComponentBuilder
    disabled={disabled}
    componentProps={componentProps}
    onValueUpdated={onValueChanged}
  />
)

export default React.memo(ModelSetting)
