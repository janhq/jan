import { useCallback, useState } from 'react'
import { ChevronLeftIcon } from 'lucide-react'
import { Input, ScrollArea } from '@janhq/joi'
import { useAtom } from 'jotai'
import { proxyAtom, proxyEnabledAtom } from '@/helpers/atoms/AppConfig.atom'
import { useDebouncedCallback } from 'use-debounce'
import { useConfigurations } from '@/hooks/useConfigurations'

const ProxySettings = ({ onBack }: { onBack: () => void }) => {
  const [proxyEnabled] = useAtom(proxyEnabledAtom)
  const [proxy, setProxy] = useAtom(proxyAtom)
  const [partialProxy, setPartialProxy] = useState<string>(proxy)
  const { configurePullOptions } = useConfigurations()

  const updatePullOptions = useDebouncedCallback(() => configurePullOptions(), 300)

  const onProxyChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value || ''
      setPartialProxy(value)
      if (value.trim().startsWith('http')) {
        setProxy(value.trim())
      } else {
        setProxy('')
      }
      updatePullOptions()
    },
    [setPartialProxy, setProxy, updatePullOptions]
  )

  return (
    <ScrollArea className="h-full w-full">
      {/* Header */}
      <div className="sticky top-0 z-10 flex h-12 items-center border-b border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] px-4">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-[hsla(var(--text-secondary))] hover:text-[hsla(var(--text-primary))]"
          >
            <ChevronLeftIcon size={16} />
            <span>Advanced Settings</span>
          </button>
          <span className="text-sm text-[hsla(var(--text-secondary))]">/</span>
          <span className="text-sm">
            <strong>HTTPS Proxy</strong>
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">HTTPS Proxy Settings</h2>
            <p className="text-sm text-[hsla(var(--text-secondary))]">
              Configure your proxy settings for internet connections
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Proxy URL</label>
              <Input
                data-testid="proxy-input"
                placeholder="http://<user>:<password>@<domain or IP>:<port>"
                value={partialProxy}
                onChange={onProxyChange}
                disabled={!proxyEnabled}
              />
              <p className="text-xs text-[hsla(var(--text-secondary))]">
                Only HTTPS proxies are supported
              </p>
            </div>

            {proxy && (
              <div className="rounded-md bg-[hsla(var(--app-box))] p-4">
                <h3 className="mb-2 font-medium">Current Proxy Settings</h3>
                <p className="text-sm text-[hsla(var(--text-secondary))]">
                  {proxy}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

export default ProxySettings