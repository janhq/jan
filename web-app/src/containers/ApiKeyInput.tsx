import { Input } from '@/components/ui/input'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export function ApiKeyInput() {
  const { apiKey, setApiKey } = useLocalApiServer()
  const [inputValue, setInputValue] = useState(apiKey.toString())
  const [showPassword, setShowPassword] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
  }

  const handleBlur = () => {
    setApiKey(inputValue)
  }

  return (
    <div className="relative w-full">
      <Input
        type={showPassword ? 'text' : 'password'}
        value={inputValue}
        onChange={handleChange}
        onBlur={handleBlur}
        className="w-full h-8 text-sm pr-10"
        placeholder="Enter API Key"
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
    </div>
  )
}
