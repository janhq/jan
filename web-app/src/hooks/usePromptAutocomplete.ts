import { useState, useEffect, useCallback } from 'react'
import { PromptTemplate } from '@janhq/core'
import { usePromptTemplates } from '@/hooks/usePromptTemplates'

interface UsePromptAutocompleteProps {
  inputValue: string
  cursorPosition: number
}

export function usePromptAutocomplete({
  inputValue,
  cursorPosition,
}: UsePromptAutocompleteProps) {
  const { searchTemplates } = usePromptTemplates()
  const [suggestions, setSuggestions] = useState<PromptTemplate[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const checkForTrigger = useCallback(() => {
    const textBeforeCursor = inputValue.slice(0, cursorPosition)
    const lastSlashIndex = textBeforeCursor.lastIndexOf('/')

    if (lastSlashIndex === -1) {
      setShowSuggestions(false)
      return
    }

    const textAfterSlash = textBeforeCursor.slice(lastSlashIndex + 1)

    if (textAfterSlash.includes(' ')) {
      setShowSuggestions(false)
      return
    }

    const matches = searchTemplates(textAfterSlash)
    setSuggestions(matches)
    setShowSuggestions(matches.length > 0)
    setSelectedIndex(0)
  }, [inputValue, cursorPosition, searchTemplates])

  useEffect(() => {
    checkForTrigger()
  }, [checkForTrigger])

  const selectSuggestion = useCallback(
    (template: PromptTemplate) => {
      const textBeforeCursor = inputValue.slice(0, cursorPosition)
      const lastSlashIndex = textBeforeCursor.lastIndexOf('/')

      const before = inputValue.slice(0, lastSlashIndex)
      const after = inputValue.slice(cursorPosition)

      return {
        newValue: `${before}${template.template}${after}`,
        newCursorPosition: (before + template.template).length,
      }
    },
    [inputValue, cursorPosition]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showSuggestions) return false

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => (i + 1) % suggestions.length)
        return true
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(
          (i) => (i - 1 + suggestions.length) % suggestions.length
        )
        return true
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (suggestions[selectedIndex]) {
          e.preventDefault()
          return selectSuggestion(suggestions[selectedIndex])
        }
      }

      if (e.key === 'Escape') {
        setShowSuggestions(false)
        return true
      }

      return false
    },
    [showSuggestions, suggestions, selectedIndex, selectSuggestion]
  )

  return {
    suggestions,
    showSuggestions,
    selectedIndex,
    selectSuggestion,
    handleKeyDown,
    closeSuggestions: () => setShowSuggestions(false),
  }
}
