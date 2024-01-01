/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-case-declarations */
import { FormControl, FormField, FormItem, FormMessage } from '@janhq/uikit'

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
  form?: any,
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
            <FormField
              key={data.title}
              control={form.control}
              name={data.name}
              render={({ field }) => (
                <>
                  <FormItem>
                    <FormControl>
                      <Slider
                        key={data.name}
                        title={data.title}
                        description={data.description}
                        min={min}
                        max={max}
                        step={step}
                        {...field}
                        value={[field.value || value]}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                </>
              )}
            />
          )
        case 'input':
          const { placeholder, value: textValue } =
            data.controllerData as InputData
          return (
            <FormField
              key={data.title}
              control={form.control}
              name={data.name}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <ModelConfigInput
                      title={data.title}
                      key={data.name}
                      description={data.description}
                      placeholder={placeholder}
                      {...field}
                      value={field.value || textValue}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )
        case 'checkbox':
          const { checked } = data.controllerData as CheckboxData
          return (
            <FormField
              key={data.title}
              control={form.control}
              name={data.name}
              render={({ field }) => (
                <>
                  <FormItem>
                    <FormControl>
                      <Checkbox
                        key={data.name}
                        description={data.description}
                        title={data.title}
                        {...field}
                        value={field.value || checked}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                </>
              )}
            />
          )
        default:
          return null
      }
    })

  return <div className="flex flex-col gap-y-4">{components}</div>
}

export default settingComponentBuilder
