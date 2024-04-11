import React from 'react'

import { SettingComponentProps } from '@janhq/core/.'

import SettingComponentBuilder from './SettingComponent'

type Props = {
  componentProps: SettingComponentProps[]
  onValueChanged: (key: string, value: string | number | boolean) => void
  disabled?: boolean
}

const ModelSetting: React.FC<Props> = ({
  componentProps,
  onValueChanged,
  disabled = false,
}) => (
  <SettingComponentBuilder
    disabled={disabled}
    componentProps={componentProps}
    onValueUpdated={onValueChanged}
  />
)

export default React.memo(ModelSetting)
