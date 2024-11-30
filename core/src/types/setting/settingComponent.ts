export type SettingComponentProps = {
  key: string
  title: string
  description: string
  controllerType: ControllerType
  controllerProps: SliderComponentProps | CheckboxComponentProps | InputComponentProps

  extensionName?: string
  requireModelReload?: boolean
  configType?: ConfigType
}

export type ConfigType = 'runtime' | 'setting'

export type ControllerType = 'slider' | 'checkbox' | 'input' | 'tag'

export type InputType = 'password' | 'text' | 'email' | 'number' | 'tel' | 'url'

const InputActions = ['unobscure', 'copy'] as const
export type InputActionsTuple = typeof InputActions
export type InputAction = InputActionsTuple[number]

export type InputComponentProps = {
  placeholder: string
  value: string | string[]
  type?: InputType
  textAlign?: 'left' | 'right'
  inputActions?: InputAction[]
}

export type SliderComponentProps = {
  min: number
  max: number
  step: number
  value: number
}

export type CheckboxComponentProps = {
  value: boolean
}
