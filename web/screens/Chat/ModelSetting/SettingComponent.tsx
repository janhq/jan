/* eslint-disable no-case-declarations */
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

const SettingComponent = ({
  componentData,
  enabled = true,
  selector,
  updater,
}: {
  componentData: SettingComponentData[]
  enabled?: boolean
  selector?: (e: SettingComponentData) => boolean
  updater?: (
    threadId: string,
    name: string,
    value: string | number | boolean | string[]
  ) => void
}) => {
  const { updateModelParameter } = useUpdateModelParameters()

  const threadId = useAtomValue(getActiveThreadIdAtom)

  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)

  const modelSettingParams = toSettingParams(activeModelParams)

  const engineParams = getConfigurationsData(modelSettingParams)

  const setEngineParamsUpdate = useSetAtom(engineParamsUpdateAtom)

  const { stopModel } = useActiveModel()

  const onValueChanged = (
    name: string,
    value: string | number | boolean | string[]
  ) => {
    if (!threadId) return
    if (engineParams.some((x) => x.name.includes(name))) {
      setEngineParamsUpdate(true)
      stopModel()
    } else {
      setEngineParamsUpdate(false)
    }
    if (updater) updater(threadId, name, value)
    else {
      // Convert stop string to array
      if (name === 'stop' && typeof value === 'string') {
        value = [value]
      }
      updateModelParameter(threadId, {
        params: { [name]: value },
      })
    }
  }

  const components = componentData
    .filter((x) => (selector ? selector(x) : true))
    .map((data) => {
      switch (data.controllerType) {
        case 'slider':
          const { min, max, step, value } = data.controllerData as SliderData
          return (
            <SliderRightPanel
              key={data.name}
              title={data.title}
              description={data.description}
              min={min}
              max={max}
              step={step}
              value={value}
              name={data.name}
              enabled={enabled}
              onValueChanged={(value) => onValueChanged(data.name, value)}
            />
          )
        case 'input':
          const { placeholder, value: textValue } =
            data.controllerData as InputData
          return (
            <ModelConfigInput
              title={data.title}
              enabled={enabled}
              key={data.name}
              name={data.name}
              description={data.description}
              placeholder={placeholder}
              value={textValue}
              onValueChanged={(value) => onValueChanged(data.name, value)}
            />
          )
        case 'checkbox':
          const { checked } = data.controllerData as CheckboxData
          return (
            <Checkbox
              key={data.name}
              enabled={enabled}
              name={data.name}
              description={data.description}
              title={data.title}
              checked={checked}
              onValueChanged={(value) => onValueChanged(data.name, value)}
            />
          )
        default:
          return null
      }
    })

  return <div className="flex flex-col gap-y-4">{components}</div>
}

export default SettingComponent
