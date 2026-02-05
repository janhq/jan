import { Input } from '@/components/ui/input'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { cn } from '@/lib/utils'
import { useState } from 'react'

export function PortInput({ isServerRunning }: { isServerRunning?: boolean }) {
  const { serverPort, setServerPort } = useLocalApiServer()
  const [inputValue, setInputValue] = useState(serverPort.toString())

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
  }

  const handleBlur = () => {
    const port = parseInt(inputValue)
    if (!isNaN(port) && port >= 0 && port <= 65535) {
      setServerPort(port)
    } else {
      // Reset to current value if invalid
      setInputValue(serverPort.toString())
    }
  }

  return (
    <Input
      type="number"
      min={0}
      max={65535}
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
