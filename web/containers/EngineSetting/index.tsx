import { SettingComponentProps } from '@janhq/core'

import SettingComponentBuilder from '@/containers/ModelSetting/SettingComponent'

type Props = {
  componentData: SettingComponentProps[]
  onValueChanged: (
    key: string,
    value: string | number | boolean | string[]
  ) => void
  disabled?: boolean
}

const EngineSetting = ({
  componentData,
  onValueChanged,
  disabled = false,
}: Props) => {
  return (
    <SettingComponentBuilder
      componentProps={componentData}
      disabled={disabled}
      onValueUpdated={onValueChanged}
    />
  )
}

export default EngineSetting
