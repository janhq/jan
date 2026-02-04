import { InputControl } from '@/containers/dynamicControllerSetting/InputControl'
import { CheckboxControl } from '@/containers/dynamicControllerSetting/CheckboxControl'
import { DropdownControl } from '@/containers/dynamicControllerSetting/DropdownControl'
import { TextareaControl } from '@/containers/dynamicControllerSetting/TextareaControl'
import { SliderControl } from '@/containers/dynamicControllerSetting/SliderControl'

// Dynamic controller component that renders the appropriate control based on controller_type
type DynamicControllerProps = {
  key?: string
  title?: string
  className?: string
  description?: string
  readonly?: boolean
  controllerType:
    | 'input'
    | 'checkbox'
    | 'dropdown'
    | 'textarea'
    | 'slider'
    | string
  controllerProps: {
    value?: string | boolean | number
    placeholder?: string
    type?: string
    options?: Array<{ value: number | string; name: string }>
    input_actions?: string[]
    rows?: number
    min?: number
    max?: number
    step?: number
    recommended?: string
  }
  onChange: (value: string | boolean | number) => void
}

export function DynamicControllerSetting({
  className,
  controllerType,
  controllerProps,
  onChange,
}: DynamicControllerProps) {
  if (controllerType === 'input') {
    return (
      <InputControl
        type={controllerProps.type}
        placeholder={controllerProps.placeholder}
        value={
          typeof controllerProps.value === 'number'
<<<<<<< HEAD
            ? controllerProps.value.toString()
=======
            ? controllerProps.value
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            : (controllerProps.value as string) || ''
        }
        inputActions={controllerProps.input_actions}
        className={className}
<<<<<<< HEAD
=======
        min={controllerProps.min}
        max={controllerProps.max}
        step={controllerProps.step}
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        onChange={(newValue) => onChange(newValue)}
      />
    )
  } else if (controllerType === 'checkbox') {
    return (
      <CheckboxControl
        checked={controllerProps.value as boolean}
        onChange={(newValue) => onChange(newValue)}
      />
    )
  } else if (controllerType === 'dropdown') {
    return (
      <DropdownControl
        value={controllerProps.value as string}
        options={controllerProps.options}
        recommended={controllerProps.recommended}
        onChange={(newValue) => onChange(newValue)}
      />
    )
  } else if (controllerType === 'textarea') {
    return (
      <TextareaControl
        placeholder={controllerProps.placeholder}
        value={(controllerProps.value as string) || ''}
        inputActions={controllerProps.input_actions}
        rows={controllerProps.rows}
        onChange={(newValue) => onChange(newValue)}
      />
    )
  } else if (controllerType === 'slider') {
    return (
      <SliderControl
        value={[controllerProps.value as number]}
        min={controllerProps.min}
        max={controllerProps.max}
        step={controllerProps.step}
        onChange={(newValue) => newValue && onChange(newValue[0])}
      />
    )
  }

  // Default to checkbox if controller type is not recognized
  return (
    <CheckboxControl
      checked={!!controllerProps.value}
      onChange={(newValue) => onChange(newValue)}
    />
  )
}
