import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from 'react-i18next'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.shortcuts as any)({
  component: Shortcuts,
})

function Shortcuts() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full">
        <SettingsMenu />
        <div className="p-4">
          <h1>Shortcuts</h1>
        </div>
      </div>
    </div>
  )
}
