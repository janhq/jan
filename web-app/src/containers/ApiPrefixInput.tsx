import { Input } from '@/components/ui/input'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { cn } from '@/lib/utils'
import { useState } from 'react'

export function ApiPrefixInput({
  isServerRunning,
}: {
  isServerRunning?: boolean
}) {
  const { apiPrefix, setApiPrefix } = useLocalApiServer()
  const [inputValue, setInputValue] = useState(apiPrefix)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
  }

  const handleBlur = () => {
    // Ensure prefix starts with a slash
    let prefix = inputValue.trim()
    if (!prefix.startsWith('/')) {
      prefix = '/' + prefix
    }
    setApiPrefix(prefix)
    setInputValue(prefix)
  }

  return (
    <Input
      type="text"
      value={inputValue}
      onChange={handleChange}
      onBlur={handleBlur}
      className={cn(
        'w-24 h-8 text-sm',
        isServerRunning && 'opacity-50 pointer-events-none'
      )}
      placeholder="/v1"
    />
  )
}
