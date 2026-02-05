import { createFileRoute } from '@tanstack/react-router'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { TagManagementDialog } from '@/components/TagManagementDialog'
import { useState } from 'react'
import { IconTags } from '@tabler/icons-react'
import { route } from '@/constants/routes'

export const Route = createFileRoute(route.settings.projects as any)({
  component: ProjectsSettings,
})

function ProjectsSettings() {
  const { t } = useTranslation()
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false)

  return (
    <div className="flex flex-col h-full pb-[calc(env(safe-area-inset-bottom)+env(safe-area-inset-top))]">
      <HeaderPage>
        <h1 className="font-medium">{t('common:settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full flex-col sm:flex-row">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* Projects & Tags */}
            <Card title={t('settings:projects.title')}>
              <CardItem
                title={t('settings:projects.tagsManagement')}
                description={t('settings:projects.tagsManagementDesc')}
                actions={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTagsDialogOpen(true)}
                    className="flex items-center gap-2"
                  >
                    <IconTags size={16} />
                    {t('settings:projects.manageTags')}
                  </Button>
                }
              />
            </Card>

            {/* Smart Collections Info (Future) */}
            <Card title={t('settings:projects.collections')}>
              <CardItem
                title={t('settings:projects.smartCollections')}
                description={t('settings:projects.smartCollectionsDesc')}
                actions={
                  <div className="text-sm text-main-view-fg/50">
                    {t('settings:projects.comingSoon')}
                  </div>
                }
              />
            </Card>

            {/* Project Templates Info (Future) */}
            <Card title={t('settings:projects.templates')}>
              <CardItem
                title={t('settings:projects.projectTemplates')}
                description={t('settings:projects.projectTemplatesDesc')}
                actions={
                  <div className="text-sm text-main-view-fg/50">
                    {t('settings:projects.comingSoon')}
                  </div>
                }
              />
            </Card>
          </div>
        </div>
      </div>

      <TagManagementDialog
        open={tagsDialogOpen}
        onOpenChange={setTagsDialogOpen}
      />
    </div>
  )
}
