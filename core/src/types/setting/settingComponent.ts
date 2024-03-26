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

export type ControllerType = 'slider' | 'checkbox' | 'input'

export type InputComponentProps = {
  placeholder: string
  value: string
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
