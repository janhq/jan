import {
  SettingComponentProps,
  InputComponentProps,
  CheckboxComponentProps,
  SliderComponentProps,
  InferenceEngine,
} from '@janhq/core'

import { useAtomValue } from 'jotai/react'

import Checkbox from '@/containers/Checkbox'
import ModelConfigInput from '@/containers/ModelConfigInput'
import SliderRightPanel from '@/containers/SliderRightPanel'

import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

type Props = {
  componentProps: SettingComponentProps[]
  disabled?: boolean
  onValueUpdated: (key: string, value: string | number | boolean) => void
}

const SettingComponent: React.FC<Props> = ({
  componentProps,
  disabled = false,
  onValueUpdated,
}) => {
  const activeThread = useAtomValue(activeThreadAtom)
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
            max={
              data.key === 'max_tokens' &&
              activeThread &&
              activeThread.assistants[0].model.engine === InferenceEngine.nitro
                ? Number(
                    activeThread &&
                      activeThread.assistants[0].model.settings.ctx_len
                  )
                : max
            }
            step={step}
            value={value}
            name={data.key}
            disabled={disabled}
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
            disabled={disabled}
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
            disabled={disabled}
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
