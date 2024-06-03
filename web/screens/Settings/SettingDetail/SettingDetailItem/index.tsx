import { SettingComponentProps } from '@janhq/core'

import SettingDetailTextInputItem from './SettingDetailTextInputItem'
import SettingDetailToggleItem from './SettingDetailToggleItem'

type Props = {
  componentProps: SettingComponentProps[]
  onValueUpdated: (key: string, value: string | number | boolean) => void
}

const SettingDetailItem = ({ componentProps, onValueUpdated }: Props) => {
  const components = componentProps.map((data) => {
    switch (data.controllerType) {
      case 'input': {
        return (
          <SettingDetailTextInputItem
            key={data.key}
            settingProps={data}
            onValueChanged={(value) => onValueUpdated(data.key, value)}
          />
        )
      }

      case 'checkbox': {
        return (
          <SettingDetailToggleItem
            key={data.key}
            settingProps={data}
            onValueChanged={(value) =>
              onValueUpdated(data.key, value.target.checked)
            }
          />
        )
      }

      default:
        return null
    }
  })

  return (
    <div className="flex w-full flex-col">
      {components.map((component, index) => (
        <div
          className={`mx-4 ${index === components.length - 1 ? '' : 'border-b border-[hsla(var(--app-border))]'}`}
          key={index}
        >
          {component}
        </div>
      ))}
    </div>
  )
}

export default SettingDetailItem
