import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Copy, Eye, EyeOff, CopyCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

type InputControl = {
  type?: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  inputActions?: string[]
  className?: string
}

export function InputControl({
  type = 'text',
  placeholder = '',
  value = '',
  onChange,
  className,
  inputActions = [],
}: InputControl) {
  const [showPassword, setShowPassword] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const hasInputActions = inputActions && inputActions.length > 0

  const copyToClipboard = () => {
    if (value) {
      navigator.clipboard.writeText(value)
      setIsCopied(true)
      setTimeout(() => {
        setIsCopied(false)
      }, 1000)
    }
  }

  const inputType = type === 'password' && showPassword ? 'text' : type

  return (
    <div
      className={cn(
        'relative',
        type === 'number' ? 'w-16' : 'w-full',
        className
      )}
    >
      <Input
        type={inputType}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          type === 'number' ? 'w-16' : 'w-full',
          hasInputActions && 'pr-16'
        )}
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
