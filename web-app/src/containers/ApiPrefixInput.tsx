import { Input } from '@/components/ui/input'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useState } from 'react'

export function ApiPrefixInput() {
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
      className="w-24 h-8 text-sm"
      placeholder="/v1"
    />
  )
}
