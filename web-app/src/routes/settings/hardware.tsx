import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { t } from 'i18next'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.hardware as any)({
  component: Hardware,
})

function Hardware() {
  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <h1>Hardware</h1>
            <p>
              Lorem ipsum dolor sit amet consectetur adipisicing elit. Rerum
              voluptas suscipit saepe non dicta quaerat, officiis nostrum
              adipisci quia delectus culpa consequatur nemo optio illum ut
              voluptates quae, consectetur magni.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
