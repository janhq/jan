import { Input } from '@/components/ui/input'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

// Split by comma, clean up each host and drop duplicates.
const parseHosts = (raw: string) => [
  ...new Set(
    raw
      .split(',')
      .map((host) => host.trim())
      .filter((host) => host.length > 0)
  ),
]

export function TrustedHostsInput({
  isServerRunning,
}: {
  isServerRunning?: boolean
}) {
  const { trustedHosts, setTrustedHosts } = useLocalApiServer()
  const [inputValue, setInputValue] = useState(trustedHosts.join(', '))
  const { t } = useTranslation()

  // Update input value when trustedHosts changes externally
  useEffect(() => {
    setInputValue(trustedHosts.join(', '))
  }, [trustedHosts])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
  }

  const commit = () => {
    const uniqueHosts = parseHosts(inputValue)
    setTrustedHosts(uniqueHosts)
    setInputValue(uniqueHosts.join(', '))
  }

  // Closing the settings popover removes the field without a blur event, so
  // an entry that was typed but not yet committed would be lost. Save it then.
  const typed = useRef(inputValue)
  typed.current = inputValue
  useEffect(
    () => () => {
      const { trustedHosts: saved, setTrustedHosts: save } =
        useLocalApiServer.getState()
      const hosts = parseHosts(typed.current)
      if (hosts.join(',') !== saved.join(',')) save(hosts)
    },
    []
  )

  return (
    <Input
      type="text"
      value={inputValue}
      onChange={handleChange}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
      placeholder={t('common:enterTrustedHosts')}
      className={cn(
        'h-8 text-sm',
        isServerRunning && 'opacity-50 pointer-events-none'
      )}
    />
  )
}
