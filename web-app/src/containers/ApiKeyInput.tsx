import { Input } from '@/components/ui/input'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useState } from 'react'

export function ApiKeyInput() {
  const { apiKey, setApiKey } = useLocalApiServer()
  const [inputValue, setInputValue] = useState(apiKey.toString())

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
  }

  const handleBlur = () => {
    setApiKey(inputValue)
  }

  return (
    <Input
      type="password"
      value={inputValue}
      onChange={handleChange}
      onBlur={handleBlur}
      className="w-full h-8 text-sm"
      placeholder="Enter API Key"
    />
  )
}
