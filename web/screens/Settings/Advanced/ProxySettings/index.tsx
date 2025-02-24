import { useCallback, useState } from 'react'

import { Input, ScrollArea, Switch } from '@janhq/joi'
import { useAtom, useAtomValue } from 'jotai'
import { EyeIcon, EyeOffIcon, XIcon, ArrowLeftIcon } from 'lucide-react'
import { useDebouncedCallback } from 'use-debounce'

import { useConfigurations } from '@/hooks/useConfigurations'

import {
  ignoreSslAtom,
  proxyAtom,
  verifyProxySslAtom,
  verifyProxyHostSslAtom,
  verifyPeerSslAtom,
  verifyHostSslAtom,
  noProxyAtom,
  proxyUsernameAtom,
  proxyPasswordAtom,
} from '@/helpers/atoms/AppConfig.atom'
import { showScrollBarAtom } from '@/helpers/atoms/Setting.atom'

const ProxySettings = ({ onBack }: { onBack: () => void }) => {
  const [proxy, setProxy] = useAtom(proxyAtom)
  const [noProxy, setNoProxy] = useAtom(noProxyAtom)
  const [partialProxy, setPartialProxy] = useState<string>(proxy)
  const [proxyUsername, setProxyUsername] = useAtom(proxyUsernameAtom)
  const [proxyPassword, setProxyPassword] = useAtom(proxyPasswordAtom)
  const [proxyPartialPassword, setProxyPartialPassword] =
    useState<string>(proxyPassword)
  const [proxyPartialUsername, setProxyPartialUsername] =
    useState<string>(proxyUsername)
  const { configurePullOptions } = useConfigurations()
  const [ignoreSSL, setIgnoreSSL] = useAtom(ignoreSslAtom)
  const [verifyProxySSL, setVerifyProxySSL] = useAtom(verifyProxySslAtom)
  const [verifyProxyHostSSL, setVerifyProxyHostSSL] = useAtom(
    verifyProxyHostSslAtom
  )
  const [verifyPeerSSL, setVerifyPeerSSL] = useAtom(verifyPeerSslAtom)
  const [verifyHostSSL, setVerifyHostSSL] = useAtom(verifyHostSslAtom)
  const [showPassword, setShowPassword] = useState(false)
  const showScrollBar = useAtomValue(showScrollBarAtom)

  const updatePullOptions = useDebouncedCallback(
    () => configurePullOptions(),
    1000
  )

  const onProxyChange = useDebouncedCallback((value: string) => {
    if (value.trim().startsWith('http')) {
      setProxy(value.trim())
      updatePullOptions()
    } else {
      setProxy('')
      updatePullOptions()
    }
  }, 1000)

  const onProxyUsernameChange = useDebouncedCallback((value: string) => {
    setProxyUsername(value)
    updatePullOptions()
  }, 1000)

  const onProxyPasswordChange = useDebouncedCallback((value: string) => {
    setProxyPassword(value)
    updatePullOptions()
  }, 1000)

  const handleProxyInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value || ''
      setPartialProxy(value)
      onProxyChange(value)
    },
    [setPartialProxy, onProxyChange]
  )

  const handleProxyUsernameInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value || ''
      setProxyPartialUsername(value)
      onProxyUsernameChange(value)
    },
    [setProxyPartialUsername, onProxyUsernameChange]
  )

  const handleProxyPasswordInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value || ''
      setProxyPartialPassword(value)
      onProxyPasswordChange(value)
    },
    [setProxyPartialPassword, onProxyPasswordChange]
  )

  const onNoProxyChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const listNoProxy = e.target.value || ''
      const listNoProxyTrim = listNoProxy.split(',').map((item) => item.trim())
      setNoProxy(listNoProxyTrim.join(','))
      updatePullOptions()
    },
    [setNoProxy, updatePullOptions]
  )

  return (
    <ScrollArea
      type={showScrollBar ? 'always' : 'scroll'}
      className="h-full w-full"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 flex h-12 items-center border-b border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] px-4">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-[hsla(var(--text-secondary))] hover:text-[hsla(var(--text-primary))]"
          >
            <ArrowLeftIcon size={16} />
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
            <h2 className="text-lg font-semibold">Proxy Configuration</h2>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
                <div className="w-full space-y-1">
                  <label className="text-sm font-medium">Proxy URL</label>
                  <p className="text-xs text-[hsla(var(--text-secondary))]">
                    URL and port of your proxy server.
                  </p>
                </div>

                <div className="flex w-full flex-shrink-0 flex-col items-end gap-2 pr-1 sm:w-1/2">
                  <div className="w-full">
                    <Input
                      data-testid="proxy-input"
                      placeholder="http://<user>:<password>@<domain or IP>:<port>"
                      value={partialProxy}
                      onChange={handleProxyInputChange}
                      suffixIcon={
                        <div className="flex items-center gap-1">
                          {partialProxy && (
                            <button
                              type="button"
                              data-testid="clear-proxy-button"
                              onClick={() => {
                                setPartialProxy('')
                                setProxy('')
                              }}
                              className="p-1 hover:text-[hsla(var(--text-primary))]"
                            >
                              <XIcon size={14} />
                            </button>
                          )}
                        </div>
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Authentication</label>
                  <p className="text-xs text-[hsla(var(--text-secondary))]">
                    Credentials for your proxy server (if required).
                  </p>
                </div>
                <div className="w-1/2 space-y-2">
                  <Input
                    data-testid="proxy-username"
                    placeholder="Username"
                    value={proxyPartialUsername}
                    onChange={handleProxyUsernameInputChange}
                    suffixIcon={
                      <div className="flex items-center gap-1">
                        {proxyUsername && (
                          <button
                            type="button"
                            data-testid="clear-username-button"
                            onClick={() => setProxyUsername('')}
                            className="p-1 hover:text-[hsla(var(--text-primary))]"
                          >
                            <XIcon size={14} />
                          </button>
                        )}
                      </div>
                    }
                  />
                  <Input
                    data-testid="proxy-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={proxyPartialPassword}
                    onChange={handleProxyPasswordInputChange}
                    suffixIcon={
                      <div className="flex items-center gap-1">
                        {proxyPassword && (
                          <button
                            type="button"
                            data-testid="clear-password-button"
                            onClick={() => {
                              setProxyPassword('')
                            }}
                            className="p-1 hover:text-[hsla(var(--text-primary))]"
                          >
                            <XIcon size={14} />
                          </button>
                        )}
                        <button
                          data-testid="password-visibility-toggle"
                          className="p-1 hover:text-[hsla(var(--text-primary))]"
                          type="button"
                          aria-label="Toggle password visibility"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <EyeOffIcon size={14} />
                          ) : (
                            <EyeIcon size={14} />
                          )}
                        </button>
                      </div>
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          {/* No Proxy */}
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <label className="text-sm font-medium">No Proxy</label>
                  <p className="text-xs text-[hsla(var(--text-secondary))]">
                    List of hosts that should bypass the proxy.
                  </p>
                </div>
                <div className="w-1/2">
                  <Input
                    data-testid="no-proxy-input"
                    placeholder="localhost, 127.0.0.1"
                    value={noProxy}
                    onChange={onNoProxyChange}
                    suffixIcon={
                      <div className="flex items-center gap-1">
                        {noProxy && (
                          <button
                            type="button"
                            onClick={() => setNoProxy('')}
                            className="p-1 hover:text-[hsla(var(--text-primary))]"
                          >
                            <XIcon size={14} />
                          </button>
                        )}
                      </div>
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <h2 className="text-lg font-semibold">SSL Verification</h2>
          </div>

          {/* Ignore SSL certificates */}
          <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
            <div className="max-w-[66%] flex-shrink-0 space-y-1">
              <div className="flex gap-x-2">
                <h6 className="font-semibold capitalize">
                  Ignore SSL certificates
                </h6>
              </div>
              <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
                Allow self-signed or unverified certificates (may be required
                for certain proxies). Enable this reduces security. Only use
                this if you trust your proxy server.
              </p>
            </div>
            <Switch
              data-testid="ignore-ssl-switch"
              checked={ignoreSSL}
              onChange={(e) => {
                setIgnoreSSL(e.target.checked)
                updatePullOptions()
              }}
            />
          </div>

          {/* Verify Proxy SSL */}
          <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
            <div className="flex-shrink-0 space-y-1">
              <div className="flex gap-x-2">
                <h6 className="font-semibold capitalize">Verify Proxy SSL</h6>
              </div>
              <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
                Validate SSL certificate when connecting to the proxy server.
              </p>
            </div>
            <Switch
              data-testid="verify-proxy-ssl-switch"
              checked={verifyProxySSL}
              onChange={(e) => {
                setVerifyProxySSL(e.target.checked)
                updatePullOptions()
              }}
            />
          </div>

          {/* Verify Proxy Host SSL */}
          <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
            <div className="flex-shrink-0 space-y-1">
              <div className="flex gap-x-2">
                <h6 className="font-semibold capitalize">
                  Verify Proxy Host SSL
                </h6>
              </div>
              <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
                Validate SSL certificate of the proxy server host.
              </p>
            </div>
            <Switch
              data-testid="verify-proxy-host-ssl-switch"
              checked={verifyProxyHostSSL}
              onChange={(e) => {
                setVerifyProxyHostSSL(e.target.checked)
                updatePullOptions()
              }}
            />
          </div>

          {/* Verify Peer SSL */}
          <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
            <div className="flex-shrink-0 space-y-1">
              <div className="flex gap-x-2">
                <h6 className="font-semibold capitalize">Verify Peer SSL</h6>
              </div>
              <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
                Validate SSL certificate of the peer connections.
              </p>
            </div>
            <Switch
              data-testid="verify-peer-ssl-switch"
              checked={verifyPeerSSL}
              onChange={(e) => {
                setVerifyPeerSSL(e.target.checked)
                updatePullOptions()
              }}
            />
          </div>

          {/* Verify Host SSL */}
          <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
            <div className="flex-shrink-0 space-y-1">
              <div className="flex gap-x-2">
                <h6 className="font-semibold capitalize">Verify Host SSL</h6>
              </div>
              <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
                Validate SSL certificate of destination hosts.
              </p>
            </div>
            <Switch
              data-testid="verify-host-ssl-switch"
              checked={verifyHostSSL}
              onChange={(e) => {
                setVerifyHostSSL(e.target.checked)
                updatePullOptions()
              }}
            />
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

export default ProxySettings
