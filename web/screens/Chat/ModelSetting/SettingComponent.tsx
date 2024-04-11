import {
  SettingComponentProps,
  InputComponentProps,
  CheckboxComponentProps,
  SliderComponentProps,
} from '@janhq/core'

import Checkbox from '@/containers/Checkbox'
import ModelConfigInput from '@/containers/ModelConfigInput'
import SliderRightPanel from '@/containers/SliderRightPanel'

type Props = {
  componentProps: SettingComponentProps[]
  enabled?: boolean
  onValueUpdated: (key: string, value: string | number | boolean) => void
}

const SettingComponent: React.FC<Props> = ({
  componentProps,
  enabled = true,
  onValueUpdated,
}) => {
  const components = componentProps.map((data) => {
    switch (data.controllerType) {
      case 'slider': {
        const { min, max, step, value } =
          data.controllerProps as SliderComponentProps
        return (
          <SliderRightPanel
            key={data.key}
            title={data.title}
            description={data.description}
            min={min}
            max={max}
            step={step}
            value={value}
            name={data.key}
            enabled={enabled}
            onValueChanged={(value) => onValueUpdated(data.key, value)}
          />
        )
      }

      case 'input': {
        const { placeholder, value: textValue } =
          data.controllerProps as InputComponentProps
        return (
          <ModelConfigInput
            title={data.title}
            enabled={enabled}
            key={data.key}
            name={data.key}
            description={data.description}
            placeholder={placeholder}
            value={textValue}
            onValueChanged={(value) => onValueUpdated(data.key, value)}
          />
        )
      }

      case 'checkbox': {
        const { value } = data.controllerProps as CheckboxComponentProps
        return (
          <Checkbox
            key={data.key}
            enabled={enabled}
            name={data.key}
            description={data.description}
            title={data.title}
            checked={value}
            onValueChanged={(value) => onValueUpdated(data.key, value)}
          />
        )
      }

      default:
        return null
    }
  })

  return <div className="flex flex-col gap-y-4">{components}</div>
}

export default SettingComponent
