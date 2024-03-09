/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/naming-convention */
import { useCallback, useState } from 'react'

const reservedModifierKeywords = [
  'shift',
  'alt',
  'meta',
  'mod',
  'ctrl',
  'option',
  'super',
]

const mappedKeys: Record<string, string> = {
  'esc': 'escape',
  'return': 'enter',
  '.': 'period',
  ',': 'comma',
  '-': 'slash',
  ' ': 'space',
  '`': 'backquote',
  '#': 'backslash',
  '+': 'bracketright',
  'ShiftLeft': 'shift',
  'ShiftRight': 'shift',
  'AltLeft': 'alt',
  'AltRight': 'alt',
  'MetaLeft': 'meta',
  'MetaRight': 'meta',
  'OSLeft': 'meta',
  'OSRight': 'meta',
  'ControlLeft': 'ctrl',
  'ControlRight': 'ctrl',
}

function mapKey(key: string): string {
  return (mappedKeys[key] || key)
    .trim()
    .toLowerCase()
    .replace(/key|digit|numpad|arrow/, '')
}

function isHotkeyModifier(key: string) {
  return reservedModifierKeywords.includes(key)
}

export default function useRecordHotkeys() {
  const [isRecording, setIsRecording] = useState(false)
  const [keys, setKeys] = useState(new Set<string>())
  const [error, setError] = useState('')

  const resetKeys = useCallback(() => {
    setError('')
    setKeys(new Set<string>())
    document.addEventListener('keydown', onKeydown)
  }, [])

  const onKeyup = useCallback(() => {
    resetKeys()
  }, [resetKeys])

  const verify = useCallback((hotkey: Set<string>) => {
    const hasModifier = reservedModifierKeywords.some((modifier) =>
      hotkey.has(modifier)
    )
    const hasNormalKey = Array.from(hotkey).some(
      (key) => !reservedModifierKeywords.includes(key)
    )

    return hasModifier && hasNormalKey && !error
  }, [])

  const isValid = verify(keys)

  const onKeydown = useCallback(
    (event: KeyboardEvent) => {
      const prefixKey = isMac ? event.metaKey : event.ctrlKey
      event.preventDefault()
      event.stopPropagation()

      const mappedKeys = mapKey(event.code)

      setKeys((prev) => {
        const newKeys = new Set(prev)
        newKeys.add(mappedKeys)

        if (Array.from(newKeys).length >= 3) {
          document.removeEventListener('keydown', onKeydown)
        }

        if (event.key === 'h' && prefixKey) {
          setError('This key is already used by the menu item Hide Jan')
          document.addEventListener('keyup', onKeyup)
        }

        if (event.key === 'k' && prefixKey) {
          document.addEventListener('keyup', onKeyup)
          setError('This key is already used for Show list navigation pages')
        }

        if (event.key === 'r' && prefixKey && event.shiftKey) {
          document.addEventListener('keyup', onKeyup)
          setError('This key is already used for hard refresh')
        }

        if (!isHotkeyModifier(Array.from(newKeys)[0])) {
          document.removeEventListener('keydown', onKeydown)
          document.addEventListener('keyup', onKeyup)
          setError('At least 1 modifier should be included.')
        }

        if (verify(newKeys)) {
          setIsRecording(false)
          document.removeEventListener('keydown', onKeydown)
        }

        return newKeys
      })
    },
    [onKeyup]
  )

  const stop = useCallback(() => {
    setIsRecording(false)
    setKeys(new Set<string>())
    document.removeEventListener('keydown', onKeydown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setKeys, setIsRecording])

  const start = useCallback(() => {
    document.addEventListener('keydown', onKeydown)
    setKeys(new Set<string>())
    setIsRecording(true)
  }, [onKeydown, setIsRecording])

  return {
    keys,
    error,
    start,
    stop,
    isRecording,
    isValid,
    isHotkeyModifier,
  } as const
}
