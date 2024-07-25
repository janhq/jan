import { SettingComponentProps } from '@janhq/core'

import SettingComponent from '../../../../containers/ModelSetting/SettingComponent'

type Props = {
  componentData: SettingComponentProps[]
  onValueChanged: (key: string, value: string | number | boolean) => void
}

const PromptTemplateSetting: React.FC<Props> = ({
  componentData,
  onValueChanged,
}) => {
  return (
    <SettingComponent
      componentProps={componentData}
      onValueUpdated={onValueChanged}
    />
  )
}

export default PromptTemplateSetting
