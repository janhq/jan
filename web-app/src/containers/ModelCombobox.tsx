import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IconChevronDown, IconLoader2, IconRefresh } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'

// Hook for the dropdown position
function useDropdownPosition(
  open: boolean,
  containerRef: React.RefObject<HTMLDivElement | null>
) {
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  })

  const updateDropdownPosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      })
    }
  }, [containerRef])

  // Update the position when the dropdown opens
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        updateDropdownPosition()
      })
    }
  }, [open, updateDropdownPosition])

  // Update the position when the window is resized
  useEffect(() => {
    if (!open) return

    const handleResize = () => {
      updateDropdownPosition()
    }

    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleResize)
    }
  }, [open, updateDropdownPosition])

  return { dropdownPosition, updateDropdownPosition }
}

// Components for the different sections of the dropdown
const ErrorSection = ({
  error,
  t,
}: {
  error: string
  t: (key: string) => string
}) => (
  <div className="px-3 py-2 text-sm text-destructive">
    <div className="flex items-center justify-between">
      <span className="text-destructive font-medium">
        {t('common:failedToLoadModels')}
      </span>
    </div>
    <div className="text-xs text-main-view-fg/50 mt-0">{error}</div>
  </div>
)

const LoadingSection = ({ t }: { t: (key: string) => string }) => (
  <div className="flex items-center justify-center px-3 py-3 text-sm text-main-view-fg/50">
    <IconLoader2 className="h-4 w-4 animate-spin mr-2 text-main-view-fg/50" />
    <span className="text-sm text-main-view-fg/50">{t('common:loading')}</span>
  </div>
)

const EmptySection = ({
  inputValue,
  t,
}: {
  inputValue: string
  t: (key: string, options?: Record<string, string>) => string
}) => (
  <div className="px-3 py-3 text-sm text-main-view-fg/50 text-center">
    <div className="flex items-center justify-between">
      <div className="flex-1">
        {inputValue.trim() ? (
          <span className="text-main-view-fg/50">
            {t('common:noModelsFoundFor', { searchValue: inputValue })}
          </span>
        ) : (
          <span className="text-main-view-fg/50">{t('common:noModels')}</span>
        )}
      </div>
    </div>
  </div>
)

const ModelsList = ({
  filteredModels,
  value,
  highlightedIndex,
  onModelSelect,
  onHighlight,
}: {
  filteredModels: string[]
  value: string
  highlightedIndex: number
  onModelSelect: (model: string) => void
  onHighlight: (index: number) => void
}) => (
  <>
    {filteredModels.map((model, index) => (
      <div
        key={model}
        data-model={model}
        onClick={(e) => {
          e.stopPropagation()
          onModelSelect(model)
        }}
        onMouseEnter={() => onHighlight(index)}
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
)

// Custom hook for keyboard navigation
function useKeyboardNavigation(
  open: boolean,
  setOpen: React.Dispatch<React.SetStateAction<boolean>>,
  models: string[],
  filteredModels: string[],
  highlightedIndex: number,
  setHighlightedIndex: React.Dispatch<React.SetStateAction<number>>,
  onModelSelect: (model: string) => void,
  dropdownRef: React.RefObject<HTMLDivElement | null>
) {
  // Scroll to the highlighted element
  useEffect(() => {
    if (highlightedIndex >= 0 && dropdownRef.current) {
      requestAnimationFrame(() => {
        const modelElements =
          dropdownRef.current?.querySelectorAll('[data-model]')
        const highlightedElement = modelElements?.[
          highlightedIndex
        ] as HTMLElement
        if (highlightedElement) {
          highlightedElement.scrollIntoView({
            block: 'nearest',
            behavior: 'auto',
          })
        }
      })
    }
  }, [highlightedIndex, dropdownRef])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Open the dropdown with the arrows if closed
      if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
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
          setHighlightedIndex((prev: number) =>
            filteredModels.length === 0
              ? 0
              : prev < filteredModels.length - 1
                ? prev + 1
                : 0
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setHighlightedIndex((prev: number) =>
            filteredModels.length === 0
              ? 0
              : prev > 0
                ? prev - 1
                : filteredModels.length - 1
          )
          break
        case 'Enter':
          e.preventDefault()
          if (
            highlightedIndex >= 0 &&
            highlightedIndex < filteredModels.length
          ) {
            onModelSelect(filteredModels[highlightedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
          setHighlightedIndex(-1)
          break
        case 'PageUp':
          e.preventDefault()
          setHighlightedIndex(0)
          break
        case 'PageDown':
          e.preventDefault()
          setHighlightedIndex(filteredModels.length - 1)
          break
      }
    },
    [
      open,
      setOpen,
      models.length,
      filteredModels,
      highlightedIndex,
      setHighlightedIndex,
      onModelSelect,
    ]
  )

  return { handleKeyDown }
}

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
  onOpenChange?: (open: boolean) => void
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
  onOpenChange,
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState(value)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const { t } = useTranslation()

  // Sync input value with prop value
  useEffect(() => {
    setInputValue(value)
  }, [value])

  // Notify parent when open state changes
  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  // Hook for the dropdown position
  const { dropdownPosition } = useDropdownPosition(open, containerRef)

  // Optimized model filtering
  const filteredModels = useMemo(() => {
    if (!inputValue.trim()) return models
    const searchValue = inputValue.toLowerCase()
    return models.filter((model) => model.toLowerCase().includes(searchValue))
  }, [models, inputValue])

  // Reset highlighted index when filtered models change
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [filteredModels])

  // Close the dropdown when clicking outside
  useEffect(() => {
    if (!open) return

    const handleClickOutside = (event: Event) => {
      const target = event.target as Node
      const isInsideContainer = containerRef.current?.contains(target)
      const isInsideDropdown = dropdownRef.current?.contains(target)

      if (!isInsideContainer && !isInsideDropdown) {
        setOpen(false)
        setHighlightedIndex(-1)
      }
    }

    const events = ['mousedown', 'touchstart']
    events.forEach((eventType) => {
      document.addEventListener(eventType, handleClickOutside, {
        capture: true,
        passive: true,
      })
    })

    return () => {
      events.forEach((eventType) => {
        document.removeEventListener(eventType, handleClickOutside, {
          capture: true,
        })
      })
    }
  }, [open])

  // Cleanup: close the dropdown when the component is unmounted
  useEffect(() => {
    return () => {
      setOpen(false)
      setHighlightedIndex(-1)
    }
  }, [])

  // Handler for the input change
  const handleInputChange = useCallback(
    (newValue: string) => {
      setInputValue(newValue)
      onChange(newValue)

      // Open the dropdown if the user types and there are models
      if (newValue.trim() && models.length > 0) {
        setOpen(true)
      } else {
        setOpen(false)
      }
    },
    [onChange, models.length]
  )

  // Handler for the model selection
  const handleModelSelect = useCallback(
    (model: string) => {
      setInputValue(model)
      onChange(model)
      setOpen(false)
      setHighlightedIndex(-1)
      inputRef.current?.focus()
    },
    [onChange]
  )

  // Hook for the keyboard navigation
  const { handleKeyDown } = useKeyboardNavigation(
    open,
    setOpen,
    models,
    filteredModels,
    highlightedIndex,
    setHighlightedIndex,
    handleModelSelect,
    dropdownRef
  )

  // Handler for the dropdown opening
  const handleDropdownToggle = useCallback(() => {
    inputRef.current?.focus()
    setOpen(!open)
  }, [open])

  // Handler for the input click
  const handleInputClick = useCallback(() => {
    if (models.length > 0) {
      setOpen(true)
    }
  }, [models.length])

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <div className="relative">
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onClick={handleInputClick}
          placeholder={placeholder}
          disabled={disabled}
          className="pr-16"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />

        {/* Input action buttons */}
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1">
          {onRefresh && (
            <Button
              variant="link"
              size="sm"
              disabled={disabled || loading}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation()
                onRefresh()
              }}
              className="h-6 w-6 p-0 no-underline hover:bg-main-view-fg/10"
              aria-label="Refresh models"
            >
              {loading ? (
                <IconLoader2 className="h-3 w-3 animate-spin" />
              ) : (
                <IconRefresh className="h-3 w-3 opacity-70" />
              )}
            </Button>
          )}
          <Button
            variant="link"
            size="sm"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleDropdownToggle}
            className="h-6 w-6 p-0 no-underline hover:bg-main-view-fg/10"
          >
            <IconChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </div>

        {/* Custom dropdown rendered as portal */}
        {open &&
          dropdownPosition.width > 0 &&
          createPortal(
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
              onPointerDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              {/* Error state */}
              {error && <ErrorSection error={error} t={t} />}

              {/* Loading state */}
              {loading && <LoadingSection t={t} />}

              {/* Models list */}
              {!loading &&
                !error &&
                (filteredModels.length === 0 ? (
                  <EmptySection inputValue={inputValue} t={t} />
                ) : (
                  <ModelsList
                    filteredModels={filteredModels}
                    value={value}
                    highlightedIndex={highlightedIndex}
                    onModelSelect={handleModelSelect}
                    onHighlight={setHighlightedIndex}
                  />
                ))}
            </div>,
            document.body
          )}
      </div>
    </div>
  )
}
