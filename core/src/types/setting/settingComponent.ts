export type SettingComponentProps = {
  key: string
  title: string
  description: string
  controllerType: ControllerType
  controllerProps:
    | SliderComponentProps
    | CheckboxComponentProps
    | InputComponentProps
    | DropdownComponentProps

  extensionName?: string
  requireModelReload?: boolean
  configType?: ConfigType
  titleKey?: string
  descriptionKey?: string
}

export type ConfigType = 'runtime' | 'setting'

export type ControllerType =
  | 'slider'
  | 'checkbox'
  | 'input'
  | 'tag'
  | 'dropdown'

export type InputType =
  | 'password'
  | 'text'
  | 'email'
  | 'number'
  | 'tel'
  | 'url'
  | 'dropdown'

const InputActions = ['unobscure', 'copy'] as const
export type InputActionsTuple = typeof InputActions
export type InputAction = InputActionsTuple[number]
export type DropdownOption = { name: string; value: string }

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

export type DropdownComponentProps = {
  value: string
  type?: InputType
  options?: DropdownOption[]
  recommended?: string
}
