import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Input } from '@/components/ui/input'
import { EyeOff, Eye } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useProxyConfig } from '@/hooks/useProxyConfig'
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { PlatformFeature } from '@/lib/platform'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.https_proxy as any)({
  component: HTTPSProxy,
})

function HTTPSProxy() {
  return (
    <PlatformGuard feature={PlatformFeature.HTTPS_PROXY}>
      <HTTPSProxyContent />
    </PlatformGuard>
  )
}

function HTTPSProxyContent() {
  const { t } = useTranslation()
  const [showPassword, setShowPassword] = useState(false)
  const {
    proxyUrl,
    proxyEnabled,
    proxyUsername,
    proxyPassword,
    proxyIgnoreSSL,
    noProxy,
    setProxyEnabled,
    setProxyUsername,
    setProxyPassword,
    setProxyIgnoreSSL,
    setNoProxy,
    setProxyUrl,
  } = useProxyConfig()

  const toggleProxy = useCallback(
    (checked: boolean) => {
      setProxyEnabled(checked)
    },
    [setProxyEnabled]
  )

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common:settings')}</h1>
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
                    {t('settings:httpsProxy.proxy')}
                  </h1>
                  <Switch
                    checked={proxyEnabled}
                    onCheckedChange={toggleProxy}
                  />
                </div>
              }
            >
              <CardItem
                title={t('settings:httpsProxy.proxyUrl')}
                className="block"
                description={
                  <div className="space-y-2">
                    <p>{t('settings:httpsProxy.proxyUrlDesc')}</p>
                    <Input
                      className="w-full"
                      placeholder={t('settings:httpsProxy.proxyUrlPlaceholder')}
                      value={proxyUrl}
                      onChange={(e) => setProxyUrl(e.target.value)}
                    />
                  </div>
                }
              />
              <CardItem
                title={t('settings:httpsProxy.authentication')}
                className="block"
                description={
                  <div className="space-y-2">
                    <p>{t('settings:httpsProxy.authenticationDesc')}</p>
                    <div className="flex gap-2">
                      <Input
                        placeholder={t('settings:httpsProxy.username')}
                        value={proxyUsername}
                        onChange={(e) => setProxyUsername(e.target.value)}
                      />
                      <div className="relative shrink-0 w-1/2">
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          placeholder={t('settings:httpsProxy.password')}
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
                title={t('settings:httpsProxy.noProxy')}
                className="block"
                description={
                  <div className="space-y-2">
                    <p>{t('settings:httpsProxy.noProxyDesc')}</p>
                    <Input
                      placeholder={t('settings:httpsProxy.noProxyPlaceholder')}
                      value={noProxy}
                      onChange={(e) => setNoProxy(e.target.value)}
                    />
                  </div>
                }
              />
              <CardItem
                title={t('settings:httpsProxy.ignoreSsl')}
                description={t('settings:httpsProxy.ignoreSslDesc')}
                actions={
                  <Switch
                    checked={proxyIgnoreSSL}
                    onCheckedChange={(checked) => setProxyIgnoreSSL(checked)}
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
