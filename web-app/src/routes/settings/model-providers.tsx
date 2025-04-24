import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { useTranslation } from 'react-i18next'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.modelProviders as any)({
  component: ModelProviders,
})

function ModelProviders() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full">
        <SettingsMenu />

        <div className="p-4">
          <p>Model Providers</p>
        </div>
      </div>
    </div>
  )
}
