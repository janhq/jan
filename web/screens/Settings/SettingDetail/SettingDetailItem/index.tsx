import { SettingComponentProps } from '@janhq/core'

import SettingDetailDropdownItem from './SettingDetailDropdownItem'
import SettingDetailTextInputItem from './SettingDetailTextInputItem'
import SettingDetailToggleItem from './SettingDetailToggleItem'

type Props = {
  componentProps: SettingComponentProps[]
  onValueUpdated: (
    key: string,
    value: string | number | boolean | string[]
  ) => void
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

      case 'dropdown': {
        return (
          <SettingDetailDropdownItem
            key={data.key}
            settingProps={data}
            onValueChanged={(value) => onValueUpdated(data.key, value)}
          />
        )
      }

      default:
        return null
    }
  })

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      {components.map((component, index) => (
        <div
          className={`${index === components.length - 1 ? '' : 'border-b border-[hsla(var(--app-border))]'}`}
          key={index}
        >
          {component}
        </div>
      ))}
    </div>
  )
}

export default SettingDetailItem
