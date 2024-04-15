import { SettingComponentProps } from '@janhq/core/.'

import SettingComponentBuilder from '../../Chat/ModelSetting/SettingComponent'

type Props = {
  componentData: SettingComponentProps[]
  onValueChanged: (key: string, value: string | number | boolean) => void
  disabled?: boolean
}

const EngineSetting: React.FC<Props> = ({
  componentData,
  onValueChanged,
  disabled = false,
}) => (
  <SettingComponentBuilder
    componentProps={componentData}
    disabled={disabled}
    onValueUpdated={onValueChanged}
  />
)

export default EngineSetting
