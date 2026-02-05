import { Input } from '@/components/ui/input'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

interface ApiKeyInputProps {
  showError?: boolean
  onValidationChange?: (isValid: boolean) => void
  isServerRunning?: boolean
}

export function ApiKeyInput({
  showError = false,
  onValidationChange,
  isServerRunning,
}: ApiKeyInputProps) {
  const { apiKey, setApiKey } = useLocalApiServer()
  const [inputValue, setInputValue] = useState(apiKey.toString())
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const { t } = useTranslation()

  const validateApiKey = useCallback(
    (value: string) => {
      if (!value || value.trim().length === 0) {
        setError(t('common:apiKeyRequired'))
        onValidationChange?.(false)
        return false
      }
      setError('')
      onValidationChange?.(true)
      return true
    },
    [onValidationChange, t]
  )

  useEffect(() => {
    if (showError) {
      validateApiKey(inputValue)
    }
  }, [showError, inputValue, validateApiKey])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)

    // Clear error when user starts typing
    if (error && value.trim().length > 0) {
      setError('')
      onValidationChange?.(true)
    }
  }

  const handleBlur = () => {
    setApiKey(inputValue)
    // Validate on blur if showError is true
    if (showError) {
      validateApiKey(inputValue)
    }
  }

  const hasError = error && showError

  return (
    <div className="relative w-full">
      <Input
        type={showPassword ? 'text' : 'password'}
        value={inputValue}
        onChange={handleChange}
        onBlur={handleBlur}
        className={cn(
          'w-full text-sm pr-10',
          hasError &&
            'border-1 border-destructive focus:border-destructive focus:ring-destructive',
          isServerRunning && 'opacity-50 pointer-events-none'
        )}
        placeholder={t('common:enterApiKey')}
      />
      <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
        <button
          onClick={() => setShowPassword(!showPassword)}
          className="p-1 rounded hover:bg-main-view-fg/5 text-main-view-fg/70"
          type="button"
        >
          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {hasError && (
        <p className="text-destructive text-xs mt-1 absolute -bottom-5 left-0">
          {error}
        </p>
      )}
    </div>
  )
}
