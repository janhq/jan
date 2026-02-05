import { Input } from '@/components/ui/input'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { cn } from '@/lib/utils'
import { useState } from 'react'

export function ProxyTimeoutInput({ isServerRunning }: { isServerRunning?: boolean }) {
  const { proxyTimeout, setProxyTimeout } = useLocalApiServer()
  const [inputValue, setInputValue] = useState(proxyTimeout.toString())

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
  }

  const handleBlur = () => {
    const timeout = parseInt(inputValue)
    if (!isNaN(timeout) && timeout >= 0 && timeout <= 86400) {
      setProxyTimeout(timeout)
    } else {
      // Reset to current value if invalid
      setInputValue(proxyTimeout.toString())
    }
  }

  return (
    <Input
      type="number"
      min={0}
      max={86400}
      value={inputValue}
      onChange={handleChange}
      onBlur={handleBlur}
      className={cn(
        'w-24 h-8 text-sm',
        isServerRunning && 'opacity-50 pointer-events-none'
      )}
    />
  )
}
