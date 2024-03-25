import {
  SettingComponentProps,
  InputComponentProps,
  CheckboxComponentProps,
  SliderComponentProps,
} from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import Checkbox from '@/containers/Checkbox'
import ModelConfigInput from '@/containers/ModelConfigInput'
import SliderRightPanel from '@/containers/SliderRightPanel'

import { useActiveModel } from '@/hooks/useActiveModel'
import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { getConfigurationsData } from '@/utils/componentSettings'
import { toSettingParams } from '@/utils/modelParam'

import {
  engineParamsUpdateAtom,
  getActiveThreadIdAtom,
  getActiveThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  componentProps: SettingComponentProps[]
  enabled?: boolean
  selector?: (e: SettingComponentProps) => boolean
  updater?: (
    threadId: string,
    name: string,
    value: string | number | boolean | string[]
  ) => void
}

const SettingComponent: React.FC<Props> = ({
  componentProps,
  enabled = true,
  selector,
  updater,
}) => {
  const threadId = useAtomValue(getActiveThreadIdAtom)
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const modelSettingParams = toSettingParams(activeModelParams)
  const engineParams = getConfigurationsData(modelSettingParams)

  const { stopModel } = useActiveModel()
  const { updateModelParameter } = useUpdateModelParameters()
  const setEngineParamsUpdate = useSetAtom(engineParamsUpdateAtom)

  const onValueChanged = (
    key: string,
    value: string | number | boolean | string[]
  ) => {
    if (!threadId) return
    if (engineParams.some((x) => x.key.includes(key))) {
      setEngineParamsUpdate(true)
      stopModel()
    } else {
      setEngineParamsUpdate(false)
    }
    if (updater) updater(threadId, key, value)
    else {
      // Convert stop string to array
      if (key === 'stop' && typeof value === 'string') {
        value = [value]
      }
      updateModelParameter(threadId, {
        params: { [key]: value },
      })
    }
  }

  const components = componentProps
    .filter((x) => (selector ? selector(x) : true))
    .map((data) => {
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
              onValueChanged={(value) => onValueChanged(data.key, value)}
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
              onValueChanged={(value) => onValueChanged(data.key, value)}
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
              onValueChanged={(value) => onValueChanged(data.key, value)}
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
