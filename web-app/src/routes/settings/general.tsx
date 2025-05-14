import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Card, CardItem } from '@/containers/Card'
import LanguageSwitcher from '@/containers/LanguageSwitcher'
import { useTranslation } from 'react-i18next'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.general as any)({
  component: General,
})

function General() {
  const { t } = useTranslation()
  const { spellCheckChatInput, setSpellCheckChatInput } = useGeneralSetting()

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* General */}
            <Card title={t('common.general')}>
              <CardItem
                title="App Version"
                actions={
                  <>
                    <span className="text-main-view-fg/80">v16.0.0</span>
                  </>
                }
              />
              <CardItem
                title={t('settings.general.autoDownload', {
                  ns: 'settings',
                })}
                actions={<Switch />}
              />
              <CardItem
                title={t('common.language')}
                actions={<LanguageSwitcher />}
              />
            </Card>

            {/* Data folder */}
            <Card title={t('common.dataFolder')}>
              <CardItem
                title={t('settings.dataFolder.appData', {
                  ns: 'settings',
                })}
                description={t('settings.dataFolder.appDataDesc', {
                  ns: 'settings',
                })}
                actions={<></>}
              />
              <CardItem
                title={t('settings.dataFolder.appLogs', {
                  ns: 'settings',
                })}
                description={t('settings.dataFolder.appLogsDesc', {
                  ns: 'settings',
                })}
                actions={<></>}
              />
            </Card>

            {/* Other */}
            <Card title={t('common.others')}>
              <CardItem
                title={t('settings.others.spellCheck', {
                  ns: 'settings',
                })}
                description={t('settings.others.spellCheckDesc', {
                  ns: 'settings',
                })}
                actions={
                  <Switch
                    checked={spellCheckChatInput}
                    onCheckedChange={(e) => setSpellCheckChatInput(e)}
                  />
                }
              />
              <CardItem
                title={t('settings.others.resetFactory', {
                  ns: 'settings',
                })}
                description={t('settings.others.resetFactoryDesc', {
                  ns: 'settings',
                })}
                actions={
                  <Button variant="destructive" size="sm">
                    {t('common.reset')}
                  </Button>
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
