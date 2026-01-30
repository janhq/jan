import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Copy, Eye, EyeOff, CopyCheck } from 'lucide-react'
import { IconMinus, IconPlus } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

type InputControl = {
  type?: string
  placeholder?: string
  value: string | number
  onChange: (value: string) => void
  inputActions?: string[]
  className?: string
  min?: number
  max?: number
  step?: number
}

export function InputControl({
  type = 'text',
  placeholder = '',
  value = '',
  onChange,
  className,
  inputActions = [],
  min,
  max,
  step = 1,
}: InputControl) {
  const [showPassword, setShowPassword] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const hasInputActions = inputActions && inputActions.length > 0

  const copyToClipboard = () => {
    if (value) {
      navigator.clipboard.writeText(String(value))
      setIsCopied(true)
      setTimeout(() => {
        setIsCopied(false)
      }, 1000)
    }
  }

  const inputType = type === 'password' && showPassword ? 'text' : type
  const hasValue = value !== undefined && value !== null && value !== ''
  const stringValue = hasValue ? String(value) : ''
  const numericValue = hasValue
    ? (typeof value === 'number' ? value : Number(value) || 0)
    : (min ?? 0)

  const handleNumberAdjustment = (delta: number) => {
    let newValue = numericValue + delta
    // Round to avoid floating point issues
    const decimals = (step.toString().split('.')[1] || '').length
    newValue = Number(newValue.toFixed(decimals))
    if (min !== undefined && newValue < min) newValue = min
    if (max !== undefined && newValue > max) newValue = max
    onChange(newValue.toString())
  }

  if (type === 'number') {
    return (
      <ButtonGroup className={className}>
        <Input
          value={stringValue || undefined}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-16 font-mono text-center text-xs!"
        />
        <Button
          variant="outline"
          size="icon-sm"
          type="button"
          aria-label="Decrement"
          className='rounded-none'
          onClick={() => handleNumberAdjustment(-step)}
          disabled={min !== undefined && numericValue <= min}
        >
          <IconMinus className='size-3! text-muted-foreground' />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          type="button"
          aria-label="Increment"
          className='rounded-r-md'
          onClick={() => handleNumberAdjustment(step)}
          disabled={max !== undefined && numericValue >= max}
        >
          <IconPlus className='size-3! text-muted-foreground' />
        </Button>
      </ButtonGroup>
    )
  }

  return (
    <div
      className={cn(
        'relative w-full',
        className
      )}
    >
      <Input
        type={inputType}
        placeholder={placeholder}
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full',
          hasInputActions && 'pr-16'
        )}
      />
      <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
        {hasInputActions &&
          inputActions.includes('unobscure') &&
          type === 'password' && (
            <button
              onClick={() => setShowPassword(!showPassword)}
              className="p-1 rounded text-muted-foreground"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}
        {hasInputActions && inputActions.includes('copy') && (
          <button
            onClick={copyToClipboard}
            className="p-1 rounded  text-muted-foreground"
          >
            {isCopied ? (
              <CopyCheck className="text-accent" size={16} />
            ) : (
              <Copy size={16} />
            )}
          </button>
        )}
      </div>
    </div>
  )
}
