import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import { Button } from '@/components/ui/button'
import {
  useOpenUISettings,
  type OpenUIComponentLibrary,
} from '@/hooks/useOpenUISettings'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.openui as any)({
  component: OpenUIIntegration,
})

const libraryOptions: Array<{
  labelKey: string
  value: OpenUIComponentLibrary
}> = [
  {
    labelKey: 'settings:openui.libraryChat',
    value: 'chat',
  },
  {
    labelKey: 'settings:openui.libraryStandard',
    value: 'standard',
  },
]

function OpenUIIntegration() {
  const { t } = useTranslation()
  const componentLibrary = useOpenUISettings((state) => state.componentLibrary)
  const setComponentLibrary = useOpenUISettings(
    (state) => state.setComponentLibrary
  )

  const copyPrompt = async () => {
    const { getOpenUISystemPrompt } = await import('@/lib/openui')
    const prompt = await getOpenUISystemPrompt(componentLibrary)
    await navigator.clipboard.writeText(prompt)
    toast.success(t('settings:openui.promptCopied'))
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
            <Card
              header={
                <div className="mb-3 flex w-full items-center gap-3">
                  <div className="flex size-12 items-center justify-center rounded-md border border-border/50 bg-background text-foreground">
                    <img
                      src="/images/openui.svg"
                      alt=""
                      className="size-11 shrink-0 dark:invert"
                    />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-foreground font-studio font-medium text-base">
                      {t('common:openui')}
                    </h1>
                    <p className="text-muted-foreground leading-normal">
                      {t('settings:openui.description')}
                    </p>
                  </div>
                </div>
              }
            >
              <CardItem
                title={t('settings:openui.enableTitle')}
                description={t('settings:openui.enableDescription')}
                align="start"
              />
              <CardItem
                title={t('settings:openui.componentLibraryTitle')}
                description={t('settings:openui.componentLibraryDescription')}
                align="start"
                actions={
                  <div className="flex gap-1 rounded-md bg-secondary p-1">
                    {libraryOptions.map((option) => (
                      <Button
                        key={option.value}
                        size="sm"
                        variant={
                          componentLibrary === option.value
                            ? 'default'
                            : 'ghost'
                        }
                        className="h-7 px-3"
                        onClick={() => setComponentLibrary(option.value)}
                      >
                        {t(option.labelKey)}
                      </Button>
                    ))}
                  </div>
                }
              />
              <CardItem
                title={t('settings:openui.systemPromptTitle')}
                description={t('settings:openui.systemPromptDescription')}
                align="start"
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={copyPrompt}
                  >
                    <Copy size={14} />
                    {t('common:copy')}
                  </Button>
                }
              />
            </Card>

            <Card title={t('settings:openui.aboutTitle')}>
              <p className="text-muted-foreground leading-normal">
                {t('settings:openui.aboutDescription')}
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
