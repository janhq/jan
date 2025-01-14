import React, { useState, useCallback } from 'react'
import { toast } from 'react-hot-toast'

interface UsernameInputProps {
  currentUsername: string
  onUsernameChange: (username: string) => Promise<void>
}

const USERNAME_REGEX = /^[a-zA-Z0-9_\- ]{3,30}$/

const UsernameInput: React.FC<UsernameInputProps> = ({
  currentUsername,
  onUsernameChange
}) => {
  const [username, setUsername] = useState(currentUsername)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const validateUsername = useCallback((value: string) => {
    if (!USERNAME_REGEX.test(value)) {
      return 'Username must be 3-30 characters and can only contain letters, numbers, spaces, underscores, and hyphens'
    }
    return ''
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedUsername = username.trim()
    const error = validateUsername(trimmedUsername)
    
    if (error) {
      setError(error)
      return
    }

    setIsLoading(true)
    try {
      await onUsernameChange(trimmedUsername)
      toast.success('Username updated successfully')
      setError('')
    } catch (error) {
      console.error('Failed to update username:', error)
      toast.error('Failed to update username')
    } finally {
      setIsLoading(false)
    }
  }, [username, onUsernameChange, validateUsername])

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="username" className="block text-sm font-medium">
          Username
        </label>
        <div className="mt-1">
          <input
            type="text"
            id="username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              setError('')
            }}
            className={`block w-full rounded-md border ${
              error ? 'border-red-300' : 'border-gray-300'
            } shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2`}
            disabled={isLoading}
          />
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading || username.trim() === currentUsername}
        className={`inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium text-white shadow-sm
          ${
            isLoading || username.trim() === currentUsername
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-blue-500 hover:bg-blue-600'
          }
        `}
      >
        {isLoading ? 'Updating...' : 'Update Username'}
      </button>
    </form>
  )
}

export default UsernameInput
