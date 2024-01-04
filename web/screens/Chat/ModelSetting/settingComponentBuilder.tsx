/* eslint-disable no-case-declarations */
import Checkbox from '@/containers/Checkbox'
import ModelConfigInput from '@/containers/ModelConfigInput'
import Slider from '@/containers/Slider'

export type ControllerType = 'slider' | 'checkbox' | 'input'

export type SettingComponentData = {
  name: string
  title: string
  description: string
  controllerType: ControllerType
  controllerData: SliderData | CheckboxData | InputData
}

export type InputData = {
  placeholder: string
  value: string
}

export type SliderData = {
  min: number
  max: number

  step: number
  value: number
}

type CheckboxData = {
  checked: boolean
}

const settingComponentBuilder = (
  componentData: SettingComponentData[],
  onlyPrompt?: boolean
) => {
  const components = componentData
    .filter((x) =>
      onlyPrompt ? x.name === 'prompt_template' : x.name !== 'prompt_template'
    )
    .map((data) => {
      switch (data.controllerType) {
        case 'slider':
          const { min, max, step, value } = data.controllerData as SliderData
          return (
            <Slider
              key={data.name}
              title={data.title}
              description={data.description}
              min={min}
              max={max}
              step={step}
              value={value}
              name={data.name}
            />
          )
        case 'input':
          const { placeholder, value: textValue } =
            data.controllerData as InputData
          return (
            <ModelConfigInput
              title={data.title}
              key={data.name}
              name={data.name}
              description={data.description}
              placeholder={placeholder}
              value={textValue}
            />
          )
        case 'checkbox':
          const { checked } = data.controllerData as CheckboxData
          return (
            <Checkbox
              key={data.name}
              name={data.name}
              description={data.description}
              title={data.title}
              checked={checked}
            />
          )
        default:
          return null
      }
    })

  return <div className="flex flex-col gap-y-4">{components}</div>
}

export default settingComponentBuilder
