import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IconChevronDown, IconLoader2, IconRefresh } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'

type ModelComboboxProps = {
  value: string
  onChange: (value: string) => void
  models: string[]
  loading?: boolean
  error?: string | null
  onRefresh?: () => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function ModelCombobox({
  value,
  onChange,
  models,
  loading = false,
  error = null,
  onRefresh,
  placeholder = 'Type or select a model...',
  disabled = false,
  className,
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState(value)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 })
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const keyRepeatTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const { t } = useTranslation()

  // Sync input value with prop value
  useEffect(() => {
    setInputValue(value)
  }, [value])

  // Simple position calculation
  const updateDropdownPosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      })
    }
  }, [])

  // Update position when opening
  useEffect(() => {
    if (open) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        updateDropdownPosition()
      })
    }
  }, [open, updateDropdownPosition])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return

    const handleClickOutside = (event: Event) => {
      const target = event.target as Node
      // Check if click is inside our container or dropdown
      const isInsideContainer = containerRef.current?.contains(target)
      const isInsideDropdown = dropdownRef.current?.contains(target)

      // Only close if click is outside both container and dropdown
      if (!isInsideContainer && !isInsideDropdown) {
        setOpen(false)
        setDropdownPosition({ top: 0, left: 0, width: 0 })
        setHighlightedIndex(-1)
      }
    }

    // Use multiple event types to ensure we catch all interactions
    const events = ['mousedown', 'touchstart']
    events.forEach(eventType => {
      document.addEventListener(eventType, handleClickOutside, { capture: true, passive: true })
    })

    return () => {
      events.forEach(eventType => {
        document.removeEventListener(eventType, handleClickOutside, { capture: true })
      })
    }
  }, [open])

  // Cleanup: close dropdown when component unmounts
  useEffect(() => {
    const timeoutId = keyRepeatTimeoutRef.current
    return () => {
      setOpen(false)
      setDropdownPosition({ top: 0, left: 0, width: 0 })
      setHighlightedIndex(-1)
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [])

    // Filter models based on input
  const filteredModels = useMemo(() => {
    if (!inputValue.trim()) return models
    
    return models.filter((model) =>
      model.toLowerCase().includes(inputValue.toLowerCase())
    )
  }, [models, inputValue])

  // Reset highlighted index when filtered models change
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [filteredModels])

  // Scroll to highlighted item with debouncing to handle key repeat
  useEffect(() => {
    if (highlightedIndex >= 0 && dropdownRef.current && !loading && !error) {
      // Use requestAnimationFrame to ensure smooth scrolling and avoid conflicts
      requestAnimationFrame(() => {
        // Find all model elements (they have the data-model attribute)
        const modelElements = dropdownRef.current?.querySelectorAll('[data-model]')
        const highlightedElement = modelElements?.[highlightedIndex] as HTMLElement
        if (highlightedElement) {
          highlightedElement.scrollIntoView({
            block: 'nearest',
            behavior: 'auto'
          })
        }
      })
    }
  }, [highlightedIndex, error, loading])

    // Handle input change
  const handleInputChange = (newValue: string) => {
    setInputValue(newValue)
    onChange(newValue)
    
    // Only open dropdown if user is actively typing and there are models
    if (newValue.trim() && models.length > 0) {
      setOpen(true)
    } else {
      // Don't auto-open on empty input - wait for user interaction
      setOpen(false)
    }
  }

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      // Open dropdown on arrow keys if there are models
      if (models.length > 0) {
        e.preventDefault()
        setOpen(true)
        setHighlightedIndex(0)
      }
      return
    }

    if (!open) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (keyRepeatTimeoutRef.current) {
          clearTimeout(keyRepeatTimeoutRef.current)
        }
        setHighlightedIndex((prev) => 
          filteredModels.length === 0 ? 0 : (prev < filteredModels.length - 1 ? prev + 1 : 0)
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        if (keyRepeatTimeoutRef.current) {
          clearTimeout(keyRepeatTimeoutRef.current)
        }
        setHighlightedIndex((prev) => 
          filteredModels.length === 0 ? 0 : (prev > 0 ? prev - 1 : filteredModels.length - 1)
        )
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < filteredModels.length) {
          handleModelSelect(filteredModels[highlightedIndex])
        }
        break
      case 'ArrowRight':
      case 'ArrowLeft':
        setOpen(false)
        setHighlightedIndex(-1)
        break
      case 'PageUp':
        setHighlightedIndex(0)
        break
      case 'PageDown':
        setHighlightedIndex(filteredModels.length - 1)
        break
    }
  }

  // Handle model selection from dropdown
  const handleModelSelect = (model: string) => {
    setInputValue(model)
    onChange(model)
    setOpen(false)
    setDropdownPosition({ top: 0, left: 0, width: 0 })
    setHighlightedIndex(-1)
    inputRef.current?.focus()
  }

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <div className="relative">
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onClick={() => {
            // Open dropdown on click if models are available
            if (models.length > 0) {
              setOpen(true)
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="pr-8"
        />

        {/* Dropdown trigger button */}
        <Button
          variant="link"
          size="sm"
          disabled={disabled}
          onMouseDown={(e) => {
            // Prevent losing focus from input
            e.preventDefault()
          }}
          onClick={() => {
            inputRef.current?.focus()
            setOpen(!open)
          }}
          className="absolute right-1 top-1/2 h-6 w-6 p-0 -translate-y-1/2 no-underline hover:bg-main-view-fg/10"
        >
          {loading ? (
            <IconLoader2 className="h-3 w-3 animate-spin" />
          ) : (
            <IconChevronDown className="h-3 w-3 opacity-50" />
          )}
        </Button>

        {/* Custom dropdown rendered as portal */}
        {open && dropdownPosition.width > 0 && createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] bg-main-view border border-main-view-fg/10 rounded-md shadow-lg max-h-[300px] overflow-y-auto text-main-view-fg animate-in fade-in-0 zoom-in-95 duration-200"
            style={{
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              width: dropdownPosition.width,
              minWidth: dropdownPosition.width,
              maxWidth: dropdownPosition.width,
              pointerEvents: 'auto',
            }}
            data-dropdown="model-combobox"
            onPointerDown={(e) => {
              // Prevent interaction with underlying elements
              e.stopPropagation()
            }}
            onClick={(e) => {
              // Prevent click from bubbling up and closing modal
              e.stopPropagation()
            }}
            onMouseDown={(e) => {
              // Allow default behavior for scrolling and selection
              e.stopPropagation()
            }}
            onWheel={(e) => {
              // Allow wheel events for scrolling
              e.stopPropagation()
            }}
          >
            {/* Error state */}
            {error && (
              <div className="px-3 py-2 text-sm text-destructive">
                <div className="flex items-center justify-between">
                  <span className="text-destructive font-medium">{t('common:failedToLoadModels')}</span>
                  {onRefresh && (
                    <Button
                      variant="link"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRefresh?.()
                      }}
                      className="h-6 w-6 p-0 no-underline hover:bg-main-view-fg/10 text-main-view-fg"
                    >
                      <IconRefresh className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <div className="text-xs text-main-view-fg/50 mt-0">{error}</div>
              </div>
            )}

            {/* Loading state */}
            {loading && (
              <div className="flex items-center justify-center px-3 py-3 text-sm text-main-view-fg/50">
                <IconLoader2 className="h-4 w-4 animate-spin mr-2 text-main-view-fg/50" />
                <span className="text-sm text-main-view-fg/50">{t('common:loading')}</span>
              </div>
            )}

            {/* Models list */}
            {!loading && !error && (
              <>
                {filteredModels.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-main-view-fg/50 text-center">
                    {inputValue.trim() ? (
                      <span className="text-main-view-fg/50">{t('common:noModelsFoundFor', { searchValue: inputValue })}</span>
                    ) : (
                      <span className="text-main-view-fg/50">{t('common:noModels')}</span>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Available models */}
                    {filteredModels.map((model, index) => (
                      <div
                        key={model}
                        data-model={model}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleModelSelect(model)
                        }}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        className={cn(
                          'cursor-pointer px-3 py-2 hover:bg-main-view-fg/15 hover:shadow-sm transition-all duration-200 text-main-view-fg',
                          value === model && 'bg-main-view-fg/12 shadow-sm',
                          highlightedIndex === index && 'bg-main-view-fg/20 shadow-md'
                        )}
                      >
                        <span className="text-sm truncate text-main-view-fg">{model}</span>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>,
          document.body
        )}
      </div>
    </div>
  )
}
