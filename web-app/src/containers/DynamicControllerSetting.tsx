import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Copy, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

// Input component with actions (unobscure, copy)
type InputWithActionsProps = {
  type?: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  inputActions?: string[]
}

export function InputWithActions({
  type = 'text',
  placeholder = '',
  value = '',
  onChange,
  inputActions = [],
}: InputWithActionsProps) {
  const [showPassword, setShowPassword] = useState(false)
  const hasInputActions = inputActions && inputActions.length > 0

  const copyToClipboard = () => {
    if (value) {
      navigator.clipboard.writeText(value)
    }
  }

  const inputType = type === 'password' && showPassword ? 'text' : type

  return (
    <div className={cn('relative', type === 'number' ? 'w-16' : 'w-full')}>
      <Input
        type={inputType}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          type === 'number' ? 'w-16' : 'w-full',
          hasInputActions && 'pr-16'
        )} // Add padding only if there are actions
      />
      <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
        {hasInputActions &&
          inputActions.includes('unobscure') &&
          type === 'password' && (
            <button
              onClick={() => setShowPassword(!showPassword)}
              className="p-1 rounded hover:bg-main-view-fg/5 text-main-view-fg/70"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}
        {hasInputActions && inputActions.includes('copy') && (
          <button
            onClick={copyToClipboard}
            className="p-1 rounded hover:bg-main-view-fg/5 text-main-view-fg/70"
          >
            <Copy size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

// Checkbox component
type CheckboxControlProps = {
  checked: boolean
  onChange: (checked: boolean) => void
}

export function CheckboxControl({ checked, onChange }: CheckboxControlProps) {
  return (
    <Switch checked={checked} onCheckedChange={(value) => onChange(value)} />
  )
}

// Dropdown component
type DropdownControlProps = {
  value: string
  options?: Array<{ value: string; name: string }>
  onChange: (value: string) => void
}

export function DropdownControl({
  value,
  options = [],
  onChange,
}: DropdownControlProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="bg-main-view-fg/5 hover:bg-main-view-fg/8 px-2 py-1 rounded font-medium cursor-pointer">
        {options.find((option) => option.value === value)?.name || value}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {options.map((option, optionIndex) => (
          <DropdownMenuItem
            key={optionIndex}
            onClick={() => onChange(option.value)}
          >
            {option.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Dynamic controller component that renders the appropriate control based on controller_type
type DynamicControllerProps = {
  controllerType: 'input' | 'checkbox' | 'dropdown'
  controllerProps: {
    value?: string | boolean
    placeholder?: string
    type?: string
    options?: Array<{ value: string; name: string }>
    input_actions?: string[]
  }
  onChange: (value: string | boolean) => void
}

export function DynamicControllerSetting({
  controllerType,
  controllerProps,
  onChange,
}: DynamicControllerProps) {
  if (controllerType === 'input') {
    return (
      <InputWithActions
        type={controllerProps.type}
        placeholder={controllerProps.placeholder}
        value={(controllerProps.value as string) || ''}
        inputActions={controllerProps.input_actions}
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
        onChange={(newValue) => onChange(newValue)}
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
