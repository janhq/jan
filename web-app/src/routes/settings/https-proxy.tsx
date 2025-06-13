import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { EyeOff, Eye } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useProxyConfig } from '@/hooks/useProxyConfig'
import { configurePullOptions } from '@/services/models'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.https_proxy as any)({
  component: HTTPSProxy,
})

function HTTPSProxy() {
  const { t } = useTranslation()
  const [showPassword, setShowPassword] = useState(false)
  const {
    proxyUrl,
    proxyEnabled,
    proxyUsername,
    proxyPassword,
    proxyIgnoreSSL,
    verifyProxySSL,
    verifyProxyHostSSL,
    verifyPeerSSL,
    verifyHostSSL,
    noProxy,
    setProxyEnabled,
    setProxyUsername,
    setProxyPassword,
    setProxyIgnoreSSL,
    setVerifyProxySSL,
    setVerifyProxyHostSSL,
    setVerifyPeerSSL,
    setVerifyHostSSL,
    setNoProxy,
    setProxyUrl,
  } = useProxyConfig()

  const toggleProxy = useCallback(
    (checked: boolean) => {
      setProxyEnabled(checked)
      configurePullOptions({
        proxyUrl,
        proxyEnabled: checked,
        proxyUsername,
        proxyPassword,
        proxyIgnoreSSL,
        verifyProxySSL,
        verifyProxyHostSSL,
        verifyPeerSSL,
        verifyHostSSL,
        noProxy,
      })
    },
    [
      noProxy,
      proxyIgnoreSSL,
      proxyPassword,
      proxyUrl,
      proxyUsername,
      setProxyEnabled,
      verifyHostSSL,
      verifyPeerSSL,
      verifyProxyHostSSL,
      verifyProxySSL,
    ]
  )

  useEffect(() => {
    const handler = setTimeout(() => {
      configurePullOptions({
        proxyUrl,
        proxyEnabled,
        proxyUsername,
        proxyPassword,
        proxyIgnoreSSL,
        verifyProxySSL,
        verifyProxyHostSSL,
        verifyPeerSSL,
        verifyHostSSL,
        noProxy,
      })
    }, 300)
    return () => clearTimeout(handler)
  }, [
    noProxy,
    proxyEnabled,
    proxyIgnoreSSL,
    proxyPassword,
    proxyUrl,
    proxyUsername,
    verifyHostSSL,
    verifyPeerSSL,
    verifyProxyHostSSL,
    verifyProxySSL,
  ])

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* Proxy Configuration */}
            <Card
              header={
                <div className="flex items-center justify-between">
                  <h1 className="text-main-view-fg font-medium text-base mb-2">
                    Proxy
                  </h1>
                  <Switch
                    checked={proxyEnabled}
                    onCheckedChange={toggleProxy}
                  />
                </div>
              }
            >
              <CardItem
                title="Proxy URL"
                className="block"
                description={
                  <div className="space-y-2">
                    <p>URL and port of your proxy server.</p>
                    <Input
                      className="w-full"
                      placeholder="http://<user>:<password>@<domain or IP>:<port>"
                      value={proxyUrl}
                      onChange={(e) => setProxyUrl(e.target.value)}
                    />
                  </div>
                }
              />
              <CardItem
                title="Authentication"
                className="block"
                description={
                  <div className="space-y-2">
                    <p>Credentials for your proxy server (if required).</p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Username"
                        value={proxyUsername}
                        onChange={(e) => setProxyUsername(e.target.value)}
                      />
                      <div className="relative shrink-0 w-1/2">
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Password"
                          className="pr-16"
                          value={proxyPassword}
                          onChange={(e) => setProxyPassword(e.target.value)}
                        />
                        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
                          <button
                            onClick={() => setShowPassword(!showPassword)}
                            className="p-1 rounded hover:bg-main-view-fg/5 text-main-view-fg/70"
                          >
                            {showPassword ? (
                              <EyeOff size={16} />
                            ) : (
                              <Eye size={16} />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                }
              />
              <CardItem
                title="No Proxy"
                className="block"
                description={
                  <div className="space-y-2">
                    <p>List of hosts that should bypass the proxy.</p>
                    <Input
                      placeholder="localhost, 127.0.0.1"
                      value={noProxy}
                      onChange={(e) => setNoProxy(e.target.value)}
                    />
                  </div>
                }
              />
            </Card>

            {/* SSL Verification */}
            <Card title="SSL Verification">
              <CardItem
                title="Ignore SSL Certificates"
                description="Allow self-signed or unverified certificates (may be required for certain proxies). Enable this reduces security. Only use this if you trust your proxy server."
                actions={
                  <Switch
                    checked={proxyIgnoreSSL}
                    onCheckedChange={(checked) => setProxyIgnoreSSL(checked)}
                  />
                }
              />
              <CardItem
                title="Proxy SSL"
                description="Validate SSL certificate when connecting to the proxy server."
                actions={
                  <Switch
                    checked={verifyProxySSL}
                    onCheckedChange={(checked) => setVerifyProxySSL(checked)}
                  />
                }
              />
              <CardItem
                title="Proxy Host SSL"
                description="Validate SSL certificate of the proxy server host."
                actions={
                  <Switch
                    checked={verifyProxyHostSSL}
                    onCheckedChange={(checked) =>
                      setVerifyProxyHostSSL(checked)
                    }
                  />
                }
              />
              <CardItem
                title="Peer SSL"
                description="Validate SSL certificate of the peer connections."
                actions={
                  <Switch
                    checked={verifyPeerSSL}
                    onCheckedChange={(checked) => setVerifyPeerSSL(checked)}
                  />
                }
              />
              <CardItem
                title="Host SSL"
                description="Validate SSL certificate of destination hosts."
                actions={
                  <Switch
                    checked={verifyHostSSL}
                    onCheckedChange={(checked) => setVerifyHostSSL(checked)}
                  />
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
